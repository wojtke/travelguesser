import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { LocalStore } from '../server/store.js';
import { createPublicService } from '../server/public-service.js';
import { scheduleDailies, searchPrefixes, identityKey, DAY } from '../server/public-content.js';
import { testAuthentication, signIn } from './helpers.js';
import { updateLive } from '../server/live.js';

async function fixture(t, photos = 1) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tripguessr-public-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new LocalStore(dir),
    s = createPublicService(store),
    app = createApp({
      store,
      auth: testAuthentication(),
      rateLimits: false,
      publicEnabled: true,
      adminUids: ['creator-admin'],
    });
  const owner = request.agent(app),
    a = request.agent(app),
    b = request.agent(app),
    guest = request.agent(app),
    admin = request.agent(app);
  await signIn(owner, 'creator-owner');
  await signIn(a, 'creator-a');
  await signIn(b, 'creator-b');
  await signIn(admin, 'creator-admin');
  const session = await guest.get('/api/session');
  guest.set('X-CSRF-Token', session.body.csrfToken);
  const game = {
    id: 'secret-original-trip',
    ownerUid: 'creator-owner',
    title: 'Private title',
    hostName: 'Original private host',
    createdAt: Date.now(),
    photos: Array.from({ length: photos }, (_, i) => ({
      key: `${i}.jpg`,
      lat: 0,
      lng: 0,
      caption: 'Answer',
    })),
  };
  await store.beginGame(game);
  await store.publishGame(game.id, game.ownerUid, 1);
  for (const p of game.photos) await store.savePhoto(game.id, p.key, Buffer.from('image-fixture'));
  const input = {
    title: 'Public Japan trip',
    nickname: 'Public author',
    tags: ['Japan', 'Cities'],
    rightsConfirmed: true,
    visibilityConfirmed: true,
    timeLimitSeconds: 60,
  };
  const publication = (
    await owner.post(`/api/games/${game.id}/publication`).send(input).expect(201)
  ).body;
  return {
    store,
    s,
    app,
    owner,
    a,
    b,
    guest,
    admin,
    game,
    publication,
    input,
    base: `/api/publications/${publication.id}`,
  };
}

test('public editions isolate original links, old players, ownership and answers', async (t) => {
  const f = await fixture(t);
  await f.store.join(f.game.id, 'historical-player', 'PRIVATE PLAYER', f.game);
  await f.store.guess(f.game, 'historical-player', { round: 0, lat: 0, lng: 0 });
  assert.notEqual(f.publication.id, f.game.id);
  const catalog = await f.guest.get('/api/catalog?q=jap').expect(200);
  assert.equal(catalog.body.items.length, 1);
  assert.ok(
    !JSON.stringify(catalog.body).match(
      /secret-original|PRIVATE PLAYER|Original private|creator-owner|ownerUid|sourceGameId|"lat"/,
    ),
  );
  assert.deepEqual((await f.guest.get(`${f.base}/leaderboard`).expect(200)).body.items, []);
  await f.a.post(`/api/games/${f.game.id}/publication`).send(f.input).expect(403);
  await f.guest.get(`${f.base}/photos/0`).expect(403);
  await f.guest
    .post(`${f.base}/join`)
    .send({ name: 'Guest', ranked: true, consent: true })
    .expect(409);
  await f.guest.post(`${f.base}/join`).send({ name: 'Guest' }).expect(200);
  await f.guest.get(`${f.base}/photos/0`).expect(200);
  await f.guest.post(`${f.base}/guess`).send({ round: 0, lat: 0, lng: 0 }).expect(200);
  assert.deepEqual((await f.guest.get(`${f.base}/leaderboard`)).body.items, []);
  await f.owner.patch(`/api/games/${f.game.id}/sharing`).send({ enabled: false }).expect(200);
  await f.guest.get(f.base).expect(404);
  await f.guest.get(`${f.base}/photos/0`).expect(404);
});

test('ranked attempts are transactional, replay-safe and removable without restoring eligibility', async (t) => {
  const { a, base, s, publication } = await fixture(t);
  const starts = await Promise.all([
    a.post(`${base}/join`).send({ name: 'Chosen nickname', ranked: true, consent: true }),
    a.post(`${base}/join`).send({ name: 'Changed', ranked: true, consent: true }),
  ]);
  assert.ok(starts.every((r) => r.status === 200));
  assert.equal(starts[0].body.publicId, starts[1].body.publicId);
  const guesses = await Promise.all([
    a.post(`${base}/guess`).send({ round: 0, lat: 0, lng: 0 }),
    a.post(`${base}/guess`).send({ round: 0, lat: 0, lng: 0 }),
  ]);
  assert.ok(guesses.every((r) => r.status === 200 && r.body.run.score === 5000));
  const board = (await a.get(`${base}/leaderboard`)).body.items;
  assert.equal(board.length, 1);
  assert.ok(!JSON.stringify(board).match(/ownerKey|creator-a|"actual"|"guess"/));
  await a
    .post(`${base}/join`)
    .send({ name: 'Again', ranked: true, consent: true, restart: true })
    .expect(409);
  await a.post(`${base}/join`).send({ name: 'Practice', restart: true }).expect(200);
  await a.post(`${base}/guess`).send({ round: 0, lat: 50, lng: 50 }).expect(200);
  assert.equal((await a.get(`${base}/leaderboard`)).body.items[0].score, 5000);
  await a.delete(`${base}/leaderboard/me`).expect(200);
  assert.equal((await a.get(`${base}/leaderboard`)).body.items.length, 0);
  assert.ok(
    (await s.data.get(s.path(publication.id, 'rankClaims', `u_${identityKey('creator-a')}`)))
      .withdrawn,
  );
});

test('public friend rooms have independent hosts, rounds and private drafts', async (t) => {
  const { a, b, guest, base, s, publication } = await fixture(t, 2);
  const roomA = (await a.post(`${base}/live`).send({ name: 'A' }).expect(201)).body;
  const roomB = (await b.post(`${base}/live`).send({ name: 'B' }).expect(201)).body;
  assert.notEqual(roomA.id, roomB.id);
  await a.post(`${base}/live`).send({ name: 'Another' }).expect(409);
  await a.post(`${base}/live/${roomB.id}/start`).send({ round: 0 }).expect(403);
  await guest.post(`${base}/live/${roomA.id}/join`).send({ name: 'Player' }).expect(200);
  await a.post(`${base}/live/${roomA.id}/start`).send({ round: 0 }).expect(200);
  assert.equal((await b.get(`${base}/live/${roomB.id}`).expect(200)).body.phase, 'lobby');
  await a.get(`${base}/live/${roomA.id}/photos/1`).expect(403);
  await guest.get(`${base}/live/${roomB.id}/photos/0`).expect(403);
  assert.equal((await a.get(base)).body.game.canRank, false);
  const key = s.path(publication.id, 'publicRooms', roomA.id);
  await s.data.transaction(async (t) => {
    const l = await t.get(key);
    t.set(key, { ...l, phase: 'round', startsAt: Date.now() - 100, startedAt: Date.now() - 100 });
  });
  await guest
    .post(`${base}/live/${roomA.id}/draft`)
    .send({ round: 0, version: 1, lat: 0, lng: 0 })
    .expect(200);
  const other = await a.get(`${base}/live/${roomA.id}`).expect(200);
  assert.equal(other.body.draft, undefined);
  assert.equal(other.body.results.length, 0);
  await a.post(`${base}/live/${roomA.id}/reveal`).send({ round: 0 }).expect(200);
  assert.equal((await guest.get(`${base}/live/${roomA.id}`)).body.results[0].score, 5000);
});

test('hosting or joining a friend room downgrades an unfinished ranked attempt', async (t) => {
  for (const mode of ['host', 'join', 'legacy']) {
    const { a, b, base, s, publication } = await fixture(t);
    await a.post(`${base}/join`).send({ name: 'Ranked', ranked: true, consent: true }).expect(200);
    if (mode === 'legacy')
      await s.data.transaction(async (tx) => {
        const key = s.path(publication.id, 'publicRuns', s.actorKey({ uid: 'creator-a' }));
        const run = await tx.get(key);
        delete run.rankedClaimKeys;
        tx.set(key, run);
      });
    const host = mode === 'join' ? b : a;
    const room = (await host.post(`${base}/live`).send({ name: 'Host' }).expect(201)).body;
    await a.post(`${base}/live/${room.id}/join`).send({ name: 'Player' }).expect(200);
    await host.post(`${base}/live/${room.id}/start`).send({ round: 0 }).expect(200);
    await s.data.transaction(async (tx) => {
      const key = s.path(publication.id, 'publicRooms', room.id),
        live = await tx.get(key);
      tx.set(key, {
        ...live,
        phase: 'round',
        startsAt: Date.now() - 100,
        startedAt: Date.now() - 100,
      });
    });
    await host.post(`${base}/live/${room.id}/reveal`).send({ round: 0 }).expect(200);
    assert.ok((await a.get(`${base}/live/${room.id}`)).body.results[0].actual);
    const result = await a.post(`${base}/guess`).send({ round: 0, lat: 0, lng: 0 }).expect(200);
    assert.equal(result.body.run.ranked, false, mode);
    assert.match(result.body.run.rankReason, /became practice/);
    assert.deepEqual((await a.get(`${base}/leaderboard`)).body.items, []);
  }
});

test('ranked eligibility follows the original browser when the account resumes elsewhere', async (t) => {
  const { s, publication } = await fixture(t);
  const id = publication.id,
    player = { uid: 'browser-player', playerId: 'original-browser' },
    guest = { playerId: player.playerId },
    host = { uid: 'other-host', playerId: 'host-browser' };
  const start = await s.join(id, player, { name: 'Ranked', ranked: true, consent: true });
  assert.ok(!JSON.stringify(start).includes('rankedClaimKeys'));
  const g = await s.createRoom(id, host, {});
  await s.mutateRoom(
    id,
    g.live.id,
    (game) => updateLive(game, g.live.id, guest, 'join', { name: 'Guest' }),
    guest,
    'join',
  );
  const { run } = await s.updateRun(id, { ...player, playerId: 'new-browser' }, 'guess', {
    round: 0,
    lat: 0,
    lng: 0,
  });
  assert.equal(run.ranked, false);
  assert.equal((await s.board(id)).length, 0);
});

test('live exposure does not retract a ranked score completed beforehand', async (t) => {
  const { a, base } = await fixture(t);
  await a.post(`${base}/join`).send({ name: 'Ranked', ranked: true, consent: true }).expect(200);
  await a.post(`${base}/guess`).send({ round: 0, lat: 0, lng: 0 }).expect(200);
  await a.post(`${base}/live`).send({ name: 'Host' }).expect(201);
  assert.equal((await a.get(base)).body.run.ranked, true);
  assert.equal((await a.get(`${base}/leaderboard`)).body.items.length, 1);
});

test('reports are private, replies work without sign-in, and moderation cannot be bypassed by republishing', async (t) => {
  const { guest, a, admin, owner, base, publication, game, input } = await fixture(t);
  const report = (
    await guest
      .post('/api/reports')
      .send({
        category: 'privacy',
        target: `/p/${publication.id}`,
        message: 'Please review this content.',
        email: 'private@example.test',
        goodFaith: true,
      })
      .expect(201)
  ).body;
  await a.get(`/api/reports/${report.id}`).expect(404);
  await a.get('/api/admin/reports').expect(403);
  await guest.get(`/api/reports/${report.id}`).set('X-Report-Token', report.token).expect(200);
  await admin
    .post(`/api/reports/${report.id}/replies`)
    .send({ message: 'Reviewed and removed.', close: true })
    .expect(200);
  const reply = (await guest.get(`/api/reports/${report.id}`).set('X-Report-Token', report.token))
    .body;
  assert.equal(reply.status, 'closed');
  assert.equal(reply.messages.length, 2);
  assert.ok(!JSON.stringify(reply).includes('private@example.test'));
  await admin
    .post(`/api/admin/publications/${publication.id}/moderate`)
    .send({ action: 'remove', reason: 'Privacy request.' })
    .expect(200);
  await guest.get(base).expect(404);
  await owner.post(`/api/games/${game.id}/publication`).send(input).expect(403);
});

test('future dailies are inaccessible and expired daily attempts cannot publish a score', async (t) => {
  const { s, a, publication, base } = await fixture(t);
  const key = `publications/${publication.id}`;
  await s.data.transaction(async (t) => {
    const p = await t.get(key);
    t.set(key, {
      ...p,
      kind: 'daily',
      ownerUid: null,
      publishedAt: Date.now() + DAY,
      dailyDate: new Date(Date.now() + DAY).toISOString().slice(0, 10),
    });
  });
  await a.get(base).expect(404);
  await a.post(`${base}/join`).send({ name: 'A' }).expect(404);
  await s.data.transaction(async (t) => {
    const p = await t.get(key);
    t.set(key, {
      ...p,
      publishedAt: Date.now() - 1000,
      dailyDate: new Date().toISOString().slice(0, 10),
    });
  });
  await a.post(`${base}/join`).send({ name: 'A', ranked: true, consent: true }).expect(200);
  const runKey = s.path(publication.id, 'publicRuns', `u_${identityKey('creator-a')}`);
  await s.data.transaction(async (t) => {
    const run = await t.get(runKey);
    t.set(runKey, { ...run, attemptDeadline: Date.now() - 100 });
  });
  const expired = (await a.get(base).expect(200)).body.run;
  assert.equal(expired.completed, true);
  assert.equal(expired.ranked, false);
  assert.equal((await a.get(`${base}/leaderboard`)).body.items.length, 0);
});

test('daily selection is deterministic, varied and respects a 30-day photo cooldown', () => {
  const assets = Array.from({ length: 200 }, (_, i) => ({
    id: `asset-${i}`,
    status: 'approved',
    country: `country-${i % 30}`,
  }));
  const rows = scheduleDailies(assets, '2026-10-01');
  assert.deepEqual(rows, scheduleDailies(assets, '2026-10-01'));
  const last = new Map();
  rows.forEach((r, day) => {
    assert.equal(new Set(r.assets).size, 5);
    for (const id of r.assets) {
      if (last.has(id)) assert.ok(day - last.get(id) >= 30);
      last.set(id, day);
    }
  });
  assert.ok(searchPrefixes('Café in Łódź', ['Poland']).includes('pol'));
  assert.throws(() => scheduleDailies(assets.slice(0, 100), '2026-10-01'), { status: 400 });
});

test('unpublishing and pausing revoke old rooms even after sharing is restored', async (t) => {
  const f = await fixture(t);
  const room = (await f.a.post(`${f.base}/live`).send({ name: 'A' }).expect(201)).body;
  await f.owner.delete(f.base).expect(200);
  await f.owner.post(`/api/games/${f.game.id}/publication`).send(f.input).expect(201);
  await f.a.get(`${f.base}/live/${room.id}`).expect(410);
  const fresh = (await f.a.post(`${f.base}/live`).send({ name: 'A' }).expect(201)).body;
  await f.owner.patch(`/api/games/${f.game.id}/sharing`).send({ enabled: false }).expect(200);
  await f.owner.patch(`/api/games/${f.game.id}/sharing`).send({ enabled: true }).expect(200);
  await f.a.get(`${f.base}/live/${fresh.id}`).expect(410);
});

test('a score can be withdrawn from an unavailable edition, and original deletion erases its public children', async (t) => {
  const f = await fixture(t);
  await f.a
    .post(`${f.base}/join`)
    .send({ name: 'Ranked', ranked: true, consent: true })
    .expect(200);
  await f.a.post(`${f.base}/guess`).send({ round: 0, lat: 0, lng: 0 }).expect(200);
  await f.owner.delete(f.base).expect(200);
  assert.equal((await f.a.get('/api/public-profile')).body.scores.length, 1);
  await f.a.delete(`${f.base}/leaderboard/me`).expect(200);
  assert.equal((await f.a.get('/api/public-profile')).body.scores.length, 0);
  await f.owner.delete(`/api/games/${f.game.id}`).expect(200);
  assert.ok(
    !Object.keys((await f.store.read()).publicData).some((k) => k.includes(f.publication.id)),
  );
});

test('an abusive score can be removed, public activity suspended and restored on review', async (t) => {
  const f = await fixture(t);
  await f.a
    .post(`${f.base}/join`)
    .send({ name: 'Reported nickname', ranked: true, consent: true })
    .expect(200);
  await f.a.post(`${f.base}/guess`).send({ round: 0, lat: 0, lng: 0 }).expect(200);
  const score = (await f.a.get(`${f.base}/leaderboard`)).body.items[0];
  await f.admin
    .post(`/api/admin/publications/${f.publication.id}/scores/${score.id}/moderate`)
    .send({ reason: 'Impersonation report upheld.', suspendPlayer: true })
    .expect(200);
  assert.deepEqual((await f.a.get(`${f.base}/leaderboard`)).body.items, []);
  assert.equal((await f.a.get('/api/public-profile')).body.suspended, true);
  await f.a.post(`${f.base}/live`).send({ name: 'A' }).expect(403);
  await f.admin
    .post(`/api/admin/profiles/${identityKey('creator-a')}/restriction`)
    .send({ suspended: false, reason: 'Appeal reviewed; restriction lifted.' })
    .expect(200);
  await f.a.post(`${f.base}/live`).send({ name: 'A' }).expect(201);
});

test('official credits are revealed only after a guess and asset withdrawal revokes photo access', async (t) => {
  const f = await fixture(t);
  await f.s.data.transaction(async (tx) => {
    const key = `publications/${f.publication.id}`,
      p = await tx.get(key);
    tx.set('officialAssets/test-asset', { id: 'test-asset', status: 'approved' });
    tx.set(key, {
      ...p,
      photos: [
        {
          ...p.photos[0],
          assetId: 'test-asset',
          credit: {
            title: 'Secret landmark',
            author: 'Photographer',
            license: 'CC0-1.0',
            source: 'https://commons.wikimedia.org/',
            licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
          },
        },
      ],
    });
  });
  const start = await f.a.post(`${f.base}/join`).send({ name: 'Player' }).expect(200);
  assert.ok(!JSON.stringify(start.body).includes('Secret landmark'));
  const result = await f.a.post(`${f.base}/guess`).send({ round: 0, lat: 0, lng: 0 }).expect(200);
  assert.equal(result.body.result.credit.title, 'Secret landmark');
  await f.s.data.transaction(async (tx) =>
    tx.set('publicControl/assets', { disabled: ['test-asset'] }),
  );
  await f.a.get(`${f.base}/photos/0`).expect(404);
  await f.a.get(`${f.base}/leaderboard`).expect(404);
});

test('schedule extensions preserve dates and photo cooldown across the boundary', () => {
  const assets = Array.from({ length: 200 }, (_, i) => ({
    id: `asset-${i}`,
    status: 'approved',
    country: `country-${i % 30}`,
  }));
  const first = scheduleDailies(assets, '2026-10-01', 35);
  const extension = scheduleDailies(assets, '2026-11-01', 35, first);
  assert.deepEqual(extension.slice(0, 4), first.slice(31));
  const combined = [...first.slice(0, 31), ...extension],
    last = new Map();
  combined.forEach((entry, day) =>
    entry.assets.forEach((id) => {
      if (last.has(id)) assert.ok(day - last.get(id) >= 30);
      last.set(id, day);
    }),
  );
  assert.throws(() => scheduleDailies(assets, '2026-02-31'), { status: 400 });
});

test('daily schedule seeding is idempotent and repairing withdrawn assets never changes released dates', async (t) => {
  const { prepareDailies, repairFutureDailies } = await import('../server/public-schedule.js');
  const f = await fixture(t),
    today = new Date().toISOString().slice(0, 10);
  await f.s.data.transaction(async (tx) => {
    for (let i = 0; i < 200; i++)
      tx.set(`officialAssets/synthetic-${i}`, {
        id: `synthetic-${i}`,
        status: 'approved',
        createdAt: Date.now(),
        key: `${i}.jpg`,
        lat: 0,
        lng: 0,
        country: `country-${i % 25}`,
        credit: { title: `Photo ${i}`, author: 'Test', license: 'CC0-1.0' },
      });
  });
  assert.equal((await prepareDailies(f.s.data, today, 3)).created, 3);
  assert.equal((await prepareDailies(f.s.data, today, 3)).created, 0);
  const dates = await f.s.data.list('dailyChallenges', { order: 'date', direction: 'asc' });
  const released = await f.s.data.get(`publications/${dates[0].publicationId}`);
  const withdrawn = [dates[0].assets[0], dates[1].assets[0]];
  await f.s.data.transaction(async (tx) => {
    for (const id of withdrawn)
      tx.set(`officialAssets/${id}`, {
        ...(await tx.get(`officialAssets/${id}`)),
        status: 'rejected',
      });
  });
  assert.equal((await repairFutureDailies(f.s.data)).repaired, 1);
  assert.deepEqual(await f.s.data.get(`publications/${dates[0].publicationId}`), released);
  const after = await f.s.data.get(`dailyChallenges/${dates[1].date}`);
  assert.ok(after.assets.every((id) => !withdrawn.includes(id)));
  assert.equal(after.assets.filter((id) => !dates[1].assets.includes(id)).length, 1);
  await f.s.data.transaction(async (tx) =>
    tx.set('publicControl/scheduler', { token: 'different-worker', until: Date.now() + 60000 }),
  );
  await assert.rejects(prepareDailies(f.s.data, today), { status: 409 });
});
