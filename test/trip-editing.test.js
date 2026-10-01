import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import request from 'supertest';
import sharp from 'sharp';
import { createApp } from '../server/app.js';
import { LocalStore } from '../server/store.js';
import { testAuthentication, signIn } from './helpers.js';
import { newLive, publicLive, updateLive } from '../server/live.js';
import { createPublicService } from '../server/public-service.js';
import {
  reserveTripEdit,
  commitTripEdit,
  discardTripEdit,
  TRIP_STORAGE_BYTES,
} from '../server/trip-editing.js';
import { UPLOAD_TIMEOUT } from '../server/limits.js';

let directory, store, app, photo;
before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'tripguessr-edit-'));
  store = new LocalStore(directory);
  app = createApp({ store, auth: testAuthentication(), rateLimits: false });
  photo = await sharp({ create: { width: 30, height: 20, channels: 3, background: 'red' } })
    .jpeg()
    .toBuffer();
});
after(() => rm(directory, { recursive: true, force: true }));
async function fixture(uid) {
  const owner = request.agent(app);
  await signIn(owner, uid);
  const created = await owner
    .post('/api/games')
    .field(
      'metadata',
      JSON.stringify({
        title: 'Original trip',
        hostName: 'Host',
        photos: [{ lat: 1, lng: 2, caption: 'Original caption' }],
      }),
    )
    .attach('photos', photo, 'photo.jpg')
    .expect(201);
  const id = created.body.id;
  return { owner, id, meta: (await owner.get(`/api/games/${id}/edit`).expect(200)).body };
}
function save(owner, id, meta, files = []) {
  let req = owner.patch(`/api/games/${id}`).field('metadata', JSON.stringify(meta));
  for (const buffer of files) req = req.attach('photos', buffer, 'photo.jpg');
  return req;
}

test('My trips thumbnails are small, metadata-free and owner-only even after a guest joins', async () => {
  const { owner, id, meta } = await fixture('creator-preview-owner');
  const url = `${meta.photos[0].url}&thumbnail=1`;
  const original = await sharp({
    create: { width: 1200, height: 900, channels: 3, background: '#406080' },
  })
    .withExif({ IFD0: { Artist: 'Private metadata' } })
    .jpeg()
    .toBuffer();
  await store.savePhoto(id, meta.photos[0].key, original);
  const other = request.agent(app);
  await signIn(other, 'creator-preview-other');
  const guest = request.agent(app);
  await guest.get(url).expect(401);
  await other.get(url).expect(403);
  for (const player of [guest, other]) {
    const view = (await player.get(`/api/games/${id}`).expect(200)).body;
    assert.ok(!JSON.stringify(view).includes('/edit/photos/'));
    assert.equal(view.game.photos, undefined);
    await player.post(`/api/games/${id}/join`).send({ name: 'Player' }).expect(200);
    await player.get(url).expect(player === guest ? 401 : 403);
  }
  const preview = await owner.get(url).expect(200).expect('Content-Type', /jpeg/);
  assert.match(preview.headers['cache-control'], /private, no-store/);
  const metadata = await sharp(preview.body).metadata();
  assert.equal(metadata.width, 240);
  assert.equal(metadata.height, 160);
  assert.equal(metadata.exif, undefined);
  assert.ok(preview.body.length < original.length);
  await owner.get(`${meta.photos[0].url}&thumbnail=2000`).expect(400);
  await owner.get(`/api/games/${id}/edit/photos/1?revision=0&thumbnail=1`).expect(404);
  await owner.get(`/api/games/${id}/edit/photos/0?revision=99&thumbnail=1`).expect(409);
  await owner.patch(`/api/games/${id}/sharing`).send({ enabled: false }).expect(200);
  await owner.get(url).expect(200);
  await other.get(url).expect(403);
  await save(owner, id, { ...meta, title: 'Updated preview trip' }).expect(200);
  await owner.get(url).expect(409);
});

test('only the owner can load and save a trip; CSRF and photo references are checked', async () => {
  const { owner, id, meta } = await fixture('creator-edit-owner');
  const other = request.agent(app);
  await signIn(other, 'creator-edit-other');
  await request(app).get(`/api/games/${id}/edit`).expect(401);
  await other.get(`/api/games/${id}/edit`).expect(403);
  await other.get(meta.photos[0].url).expect(403);
  await save(other, id, meta).expect(403);
  await request(app)
    .patch(`/api/games/${id}`)
    .set('Cookie', (await signIn(request.agent(app), 'creator-edit-owner')).headers['set-cookie'])
    .field('metadata', JSON.stringify(meta))
    .expect(403);
  await owner.get(meta.photos[0].url).expect(200);
  await save(owner, id, {
    ...meta,
    photos: [{ key: '../someone-else.jpg', lat: 0, lng: 0 }],
  }).expect(400);
  await save(owner, id, { ...meta, photos: [] }).expect(400);
  await save(owner, id, { ...meta, photos: [{ ...meta.photos[0], lat: 91 }] }).expect(400);
  await save(owner, id, { ...meta, photos: [{ lat: 0, lng: 0, uploadIndex: 0 }] }, [
    Buffer.from('invalid'),
  ]).expect(400);
  await owner.patch(`/api/games/${id}/sharing`).send({ enabled: false }).expect(200);
  await save(owner, id, {
    ...meta,
    title: 'Edited paused trip',
    ownerUid: 'creator-edit-other',
    sharing: true,
  }).expect(200);
  const game = await store.getGame(id);
  assert.equal(game.ownerUid, 'creator-edit-owner');
  assert.equal(game.sharing, false);
  assert.equal(game.title, 'Edited paused trip');
  await other.get(`/api/games/${id}`).expect(403);
});

test('edits preserve legacy and current playthroughs, results, photos and first-version leaderboards', async () => {
  const { owner, id, meta } = await fixture('creator-edit-history');
  const players = [request.agent(app), request.agent(app)];
  for (const [i, player] of players.entries())
    await player
      .post(`/api/games/${id}/join`)
      .send({ name: `Player ${i}` })
      .expect(200);
  await store.mutate((d) => {
    for (const run of Object.values(d.runs))
      if (run.gameId === id && run.name === 'Player 0') delete run.tripSnapshot;
  });
  const oldPhoto = (await players[0].get(`/api/games/${id}/photos/0`)).body;
  const revised = {
    ...meta,
    title: 'Changed trip',
    settings: { timeLimitSeconds: 120 },
    photos: [
      { lat: -20, lng: 120, caption: 'New photo', uploadIndex: 0 },
      { ...meta.photos[0], lat: 30, lng: 40 },
    ],
  };
  await save(owner, id, revised, [photo]).expect(200);
  for (const player of players) {
    const view = (await player.get(`/api/games/${id}`)).body;
    assert.equal(view.game.title, 'Original trip');
    assert.equal(view.game.rounds, 1);
    assert.equal(view.game.settings.timeLimitSeconds, 0);
    assert.deepEqual((await player.get(`/api/games/${id}/photos/0`)).body, oldPhoto);
    const guessed = (
      await player.post(`/api/games/${id}/guess`).send({ round: 0, lat: 1, lng: 2 }).expect(200)
    ).body;
    assert.equal(guessed.run.completed, true);
    assert.equal(guessed.result.score, 5000);
    assert.equal(guessed.result.caption, 'Original caption');
    assert.ok(!JSON.stringify(guessed).includes('tripSnapshot'));
  }
  const fresh = request.agent(app);
  const view = (await fresh.get(`/api/games/${id}`)).body;
  assert.equal(view.game.title, 'Changed trip');
  assert.equal(view.game.rounds, 2);
  assert.ok(!JSON.stringify(view).includes('originalTrip'));
  assert.equal((await fresh.get(`/api/games/${id}/leaderboard`)).body.length, 0);
  assert.equal((await players[0].get(`/api/games/${id}/leaderboard`)).body.length, 2);
  await fresh.post(`/api/games/${id}/join`).send({ name: 'New player' }).expect(200);
  const result = await fresh
    .post(`/api/games/${id}/guess`)
    .send({ round: 0, lat: -20, lng: 120 })
    .expect(200);
  assert.equal(result.body.result.score, 5000);
  assert.equal(result.body.run.completed, false);
  const latest = (await owner.get(`/api/games/${id}/edit`)).body;
  await save(owner, id, { ...latest, title: 'Third version' }).expect(200);
  assert.equal((await fresh.get(`/api/games/${id}`)).body.game.title, 'Changed trip');
});

test('live lobbies and published editions keep their original photos and rules after an edit', async () => {
  const { owner, id, meta } = await fixture('creator-edit-live');
  const service = createPublicService(store);
  const edition = await service.publish(id, 'creator-edit-live', {
    title: 'Public original',
    nickname: 'Host',
    tags: [],
    rightsConfirmed: true,
    visibilityConfirmed: true,
  });
  let game = await store.mutateGame(id, (g) => newLive(g));
  const liveId = game.live.id;
  await store.mutateGame(id, (g) =>
    updateLive(g, liveId, { playerId: 'guest' }, 'join', { name: 'Guest' }),
  );
  await save(owner, id, {
    ...meta,
    title: 'Private revision',
    photos: [{ ...meta.photos[0], lat: 20, lng: 30 }],
  }).expect(200);
  const publicPhoto = (await store.read()).publicData[`publications/${edition.id}`].photos[0];
  assert.equal(publicPhoto.lat, 1);
  game = await store.mutateGame(id, (g) =>
    updateLive(g, liveId, { uid: 'creator-edit-live' }, 'start', { round: 0 }, Date.now() - 5100),
  );
  game = await store.mutateGame(id, (g) =>
    updateLive(g, liveId, { playerId: 'guest' }, 'guess', { round: 0, lat: 1, lng: 2 }),
  );
  const state = publicLive(game, { playerId: 'guest' });
  assert.equal(state.title, 'Original trip');
  assert.equal(state.results[0].score, 5000);
  assert.ok(!JSON.stringify(state).includes('tripSnapshot'));
});

test('concurrent saves reject stale editors and editing does not consume another trip slot', async () => {
  const { owner, id, meta } = await fixture('creator-edit-concurrent');
  const results = await Promise.all([
    save(owner, id, { ...meta, title: 'First save' }),
    save(owner, id, { ...meta, title: 'Second save' }),
  ]);
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.equal(results.filter((r) => [409, 429].includes(r.status)).length, 1);
  assert.equal((await store.getGame(id)).tripRevision, 1);
  assert.equal((await owner.get('/api/host/usage')).body.trips, 1);
  await owner.get(meta.photos[0].url).expect(409);
  await save(owner, id, meta).expect(409);
  for (let i = 0; i < 4; i++) {
    await store.beginGame({ ...(await store.getGame(id)), id: `extra-edit-trip-${i}` });
    await store.publishGame(`extra-edit-trip-${i}`, 'creator-edit-concurrent', 0);
  }
  const current = (await owner.get(`/api/games/${id}/edit`)).body;
  await save(owner, id, { ...current, title: 'Edited with all five slots full' }).expect(200);
  assert.equal((await owner.get('/api/host/usage')).body.trips, 5);
});

test('failed uploads roll back only their files; interrupted edits recover without changing the trip', async () => {
  const { owner, id, meta } = await fixture('creator-edit-recovery');
  const before = (await store.getGame(id)).storageBytes;
  const originalSave = store.savePhoto;
  store.savePhoto = async function (...args) {
    await originalSave.apply(this, args);
    throw new Error('Synthetic interrupted storage write');
  };
  try {
    await save(owner, id, { ...meta, photos: [{ lat: 0, lng: 0, uploadIndex: 0 }] }, [
      photo,
    ]).expect(500);
  } finally {
    store.savePhoto = originalSave;
  }
  assert.deepEqual(await readdir(path.join(directory, 'photos', id)), ['0.jpg']);
  assert.equal((await store.getUsage('creator-edit-recovery')).storageBytes, before);
  const upload = {
    token: 'synthetic',
    keys: ['edit-synthetic-0.jpg'],
    bytes: photo.length,
    createdAt: Date.now() - UPLOAD_TIMEOUT - 1000,
  };
  await reserveTripEdit(store, id, 'creator-edit-recovery', 0, upload);
  await store.savePhoto(id, upload.keys[0], photo);
  const recovered = (await owner.get(`/api/games/${id}/edit`).expect(200)).body;
  assert.equal(recovered.title, meta.title);
  assert.equal(recovered.storageBytes, before);
  assert.deepEqual(await readdir(path.join(directory, 'photos', id)), ['0.jpg']);
  await save(owner, id, { ...recovered, title: 'Recovered save' }).expect(200);
  const savedUpload = {
    token: 'committed',
    keys: ['edit-committed-0.jpg'],
    bytes: photo.length,
    createdAt: Date.now(),
  };
  await reserveTripEdit(store, id, 'creator-edit-recovery', 1, savedUpload);
  await store.savePhoto(id, savedUpload.keys[0], photo);
  await commitTripEdit(store, id, 'creator-edit-recovery', 1, savedUpload.token, {
    photos: [{ key: savedUpload.keys[0], lat: 0, lng: 0 }],
  });
  await discardTripEdit(store, id, 'creator-edit-recovery', savedUpload);
  assert.deepEqual(await store.getPhoto(id, savedUpload.keys[0]), photo);
  assert.equal((await store.getGame(id)).storageBytes, before + photo.length);
});

test('retained media stays within the trip storage cap while text edits remain possible', async () => {
  const { owner, id, meta } = await fixture('creator-edit-cap');
  await store.mutateOwnedGame(id, 'creator-edit-cap', (g) => ({
    ...g,
    storageBytes: TRIP_STORAGE_BYTES,
  }));
  await save(owner, id, { ...meta, photos: [{ lat: 0, lng: 0, uploadIndex: 0 }] }, [photo]).expect(
    409,
  );
  await save(owner, id, { ...meta, title: 'Text update at the cap' }).expect(200);
  assert.equal((await store.getUsage('creator-edit-cap')).storageBytes, TRIP_STORAGE_BYTES);
});
