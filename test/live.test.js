import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import sharp from 'sharp';
import { createApp } from '../server/app.js';
import { LocalStore } from '../server/store.js';
import { applyGuess, beginRound, gameSettings, newRun, publicRun } from '../server/game.js';
import { newLive, updateLive, expireLive, publicLive, getLive } from '../server/live.js';
import { signIn, testAuthentication } from './helpers.js';

const sample = {
  id: 'test-live-trip',
  ownerUid: 'creator',
  title: 'Two places',
  hostName: 'Host',
  photos: [
    { key: '0.jpg', lat: 10, lng: 20, caption: 'First place' },
    { key: '1.jpg', lat: 0, lng: 0, caption: 'Second place' },
  ],
  settings: gameSettings({ timeLimitSeconds: 15 }),
};
const host = { uid: 'creator', playerId: 'host' },
  alice = { playerId: 'alice' },
  bob = { playerId: 'bob' };
function lobby(timeLimitSeconds = 15) {
  let g = newLive(sample, { timeLimitSeconds }, 1000);
  delete g.live.protocolVersion; // Existing lobbies keep the immediate-start protocol.
  g = updateLive(g, g.live.id, alice, 'join', { name: 'Alice' }, 1001);
  return updateLive(g, g.live.id, bob, 'join', { name: 'Bob' }, 1002);
}

test('live rounds reveal together, score once, and only the host advances', () => {
  let g = lobby(),
    id = g.live.id;
  assert.throws(() => updateLive(g, id, alice, 'start', { round: 0 }, 2000), { status: 403 });
  g = updateLive(g, id, host, 'start', { round: 0 }, 2000);
  assert.equal(g.live.deadline, 17000);
  assert.equal(publicLive(g, { playerId: 'outsider' }, 2000).photoUrl, null);
  assert.deepEqual(publicLive(g, { playerId: 'outsider' }, 2000).players, []);
  assert.throws(() => updateLive(g, id, { playerId: 'late' }, 'join', { name: 'Late' }, 2001), {
    status: 409,
  });
  g = updateLive(g, id, alice, 'guess', { round: 0, lat: 10, lng: 20 }, 3000);
  const hidden = publicLive(g, bob, 3000);
  assert.equal(hidden.phase, 'round');
  assert.deepEqual(hidden.results, []);
  assert.equal(hidden.me.guess, null);
  assert.ok(!JSON.stringify(hidden).includes('"lat":10'));
  assert.equal(hidden.players.find((p) => p.name === 'Alice').submitted, true);
  const retry = updateLive(g, id, alice, 'guess', { round: 0, lat: 0, lng: 0 }, 3001);
  assert.equal(retry, g);
  g = updateLive(g, id, bob, 'guess', { round: 0, lat: 0, lng: 0 }, 4000);
  assert.equal(g.live.phase, 'results');
  assert.equal(g.live.players.alice.score, 5000);
  assert.equal(publicLive(g, bob, 4000).results[0].distance, 0);
  assert.deepEqual(publicLive(g, { playerId: 'outsider' }, 4000).results, []);
  g = updateLive(g, id, host, 'next', { round: 0 }, 5000);
  assert.equal(g.live.round, 1);
  assert.equal(g.live.deadline, 20000);
  assert.equal(updateLive(g, id, host, 'next', { round: 0 }, 5001), g);
  g = updateLive(g, id, bob, 'guess', { round: 1, lat: 0, lng: 0 }, 6000);
  g = expireLive(g, 20000);
  assert.equal(g.live.phase, 'results');
  assert.equal(g.live.players.alice.results[1].guess, null);
  assert.equal(g.live.players.alice.score, 5000);
  assert.equal(expireLive(g, 20001), g);
  g = updateLive(g, id, host, 'next', { round: 1 }, 21000);
  assert.equal(g.live.phase, 'finished');
});

test('deadlines cannot be bypassed, untimed rounds can be revealed, and removal avoids deadlock', () => {
  let g = lobby(),
    id = g.live.id;
  g = updateLive(g, id, host, 'start', { round: 0 }, 2000);
  g = updateLive(g, id, alice, 'guess', { round: 0, lat: 10, lng: 20 }, 17000);
  assert.equal(g.live.phase, 'results');
  assert.equal(g.live.players.alice.score, 0);
  assert.equal(g.live.players.alice.guess, null);
  g = lobby(0);
  id = g.live.id;
  g = updateLive(g, id, host, 'start', { round: 0 }, 2000);
  assert.equal(expireLive(g, 30000), g);
  g = updateLive(g, id, alice, 'guess', { round: 0, lat: 10, lng: 20 }, 30000);
  g = updateLive(g, id, host, 'remove', { playerId: g.live.players.bob.id }, 30001);
  assert.equal(g.live.phase, 'results');
  assert.equal(g.live.players.bob.results[0].score, 0);
  g = updateLive(g, id, host, 'next', { round: 0 }, 30002);
  assert.deepEqual(g.live.roster, ['alice']);
  g = updateLive(g, id, host, 'reveal', { round: 1 }, 30003);
  assert.equal(g.live.players.alice.results[1].score, 0);
  assert.throws(() => getLive(g, id, g.live.expiresAt), { status: 410 });
  assert.notEqual(newLive(g, {}, g.live.expiresAt).live.id, id);
});

test('lobby capacity, unique names, player identity, settings and session reuse', () => {
  let g = lobby();
  const id = g.live.id;
  assert.equal(newLive(g, {}, 2000), g);
  assert.throws(() => updateLive(g, id, { playerId: 'extra' }, 'join', { name: 'alice' }, 2000), {
    status: 409,
  });
  for (let i = 2; i < 20; i++)
    g = updateLive(g, id, { playerId: `p${i}` }, 'join', { name: `Player ${i}` }, 2000);
  assert.throws(() => updateLive(g, id, { playerId: 'extra' }, 'join', { name: 'Extra' }, 2000), {
    status: 409,
  });
  assert.equal(
    publicLive({ ...g, ownerUid: undefined }, { playerId: 'outsider' }, 2000).isHost,
    false,
  );
  assert.throws(() => gameSettings({ timeLimitSeconds: -1 }), { status: 400 });
  assert.throws(() => gameSettings({ shufflePhotos: 'true' }), { status: 400 });
  assert.throws(() => gameSettings(null), { status: 400 });
});

test('solo timers are server-enforced and delayed next-round retries cannot start a later timer', () => {
  let run = newRun(sample, 'Player', 1000);
  run.order = [1, 0]; // The stored order, not the upload index, controls scoring.
  assert.throws(() => applyGuess(sample, run, { round: 0, timedOut: true }, 2000), { status: 409 });
  run = applyGuess(sample, run, { round: 0, lat: 0, lng: 0 }, 15000).run;
  assert.equal(run.score, 5000);
  assert.equal(publicRun(sample, run).awaitingNext, true);
  assert.throws(() => applyGuess(sample, run, { round: 1, lat: 10, lng: 20 }, 15001), {
    status: 409,
  });
  assert.throws(() => beginRound(run, 0, 16000), { status: 409 });
  run = beginRound(run, 1, 16000);
  assert.equal(beginRound(run, 1, 17000), run);
  const late = applyGuess(sample, run, { round: 1, lat: 10, lng: 20 }, 31000);
  assert.equal(late.result.timedOut, true);
  assert.equal(late.result.guess, null);
  assert.equal(late.run.score, 5000);
  assert.equal(applyGuess(sample, late.run, { round: 1, lat: 10, lng: 20 }, 32000).run.score, 5000);
});

let dir, store, app, photo;
before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'tripguessr-live-test-'));
  store = new LocalStore(dir);
  app = createApp({ store, auth: testAuthentication(), rateLimits: false });
  photo = await sharp({ create: { width: 60, height: 40, channels: 3, background: '#abc' } })
    .jpeg()
    .toBuffer();
});
after(async () => rm(dir, { recursive: true, force: true }));
async function fixture(settings = { mode: 'live', timeLimitSeconds: 15 }) {
  const owner = request.agent(app);
  await signIn(owner);
  const response = await owner
    .post('/api/games')
    .field(
      'metadata',
      JSON.stringify({
        title: 'Live fixture',
        hostName: 'Creator',
        settings,
        photos: sample.photos,
      }),
    )
    .attach('photos', photo, 'one.jpg')
    .attach('photos', photo, 'two.jpg')
    .expect(201);
  return { owner, ...response.body };
}
async function guest() {
  const agent = request.agent(app),
    s = await agent.get('/api/session');
  agent.set('X-CSRF-Token', s.body.csrfToken);
  return agent;
}

test('HTTP live flow persists concurrent guesses, protects media and host actions, and pauses all link access', async () => {
  const { owner, id, liveId } = await fixture(),
    a = await guest(),
    b = await guest(),
    outsider = await guest();
  const base = `/api/games/${id}/live/${liveId}`;
  assert.equal(id.length, 22);
  assert.equal(liveId.length, 22);
  await a.post(`${base}/join`).send({ name: 'A' }).expect(200);
  await b.post(`${base}/join`).send({ name: 'B' }).expect(200);
  await a.post(`${base}/start`).send({ round: 0 }).expect(403);
  await a.get(`${base}/photos/0`).expect(403);
  await store.mutateGame(id, (g) => {
    delete g.live.protocolVersion;
    return g;
  });
  await owner.post(`${base}/start`).send({ round: 0 }).expect(200);
  await outsider.get(`${base}/photos/0`).expect(403);
  await a.get(`${base}/photos/1`).expect(403);
  await a
    .get(`${base}/photos/0`)
    .expect(200)
    .expect('Cache-Control', 'private, no-store')
    .expect('X-Robots-Tag', /noindex/);
  await a.post(`/api/games/${id}/guess`).send({ round: 0, lat: 10, lng: 20 }).expect(409);
  const responses = await Promise.all([
    a.post(`${base}/guess`).send({ round: 0, lat: 10, lng: 20 }),
    b.post(`${base}/guess`).send({ round: 0, lat: 10, lng: 20 }),
  ]);
  assert.ok(responses.every((r) => r.status === 200));
  let state = (await a.get(base).expect(200)).body;
  assert.equal(state.phase, 'results');
  assert.deepEqual(
    state.results.map((p) => p.score),
    [5000, 5000],
  );
  await owner.post(`${base}/next`).send({ round: 0 }).expect(200);
  await store.mutateGame(id, (g) => ({ ...g, live: { ...g.live, deadline: Date.now() - 1000 } }));
  state = (await b.get(base).expect(200)).body;
  assert.equal(state.phase, 'results');
  assert.deepEqual(
    state.results.map((p) => p.score),
    [0, 0],
  );
  const otherOwner = request.agent(app);
  await signIn(otherOwner, 'creator-b');
  await otherOwner.patch(`/api/games/${id}/sharing`).send({ enabled: false }).expect(403);
  await owner.patch(`/api/games/${id}/sharing`).send({ enabled: false }).expect(200);
  for (const suffix of [
    '',
    '/photos/0',
    '/leaderboard',
    `/live/${liveId}`,
    `/live/${liveId}/photos/0`,
  ])
    await a.get(`/api/games/${id}${suffix}`).expect(403);
  await owner.get(`/api/games/${id}`).expect(200);
  await owner.patch(`/api/games/${id}/sharing`).send({ enabled: true }).expect(200);
  const next = (
    await owner.post(`/api/games/${id}/live`).send({ timeLimitSeconds: 30 }).expect(200)
  ).body;
  assert.notEqual(next.id, liveId);
  await a.get(base).expect(404);
  await owner.delete(`/api/games/${id}`).expect(200);
});

test('timed solo photos cannot be previewed before their timer starts; trip pages are noindex', async () => {
  const { id, owner } = await fixture({ mode: 'solo', timeLimitSeconds: 15 }),
    a = await guest();
  await a.post(`/api/games/${id}/join`).send({ name: 'Timed player' }).expect(200);
  await a.post(`/api/games/${id}/guess`).send({ round: 0, lat: 10, lng: 20 }).expect(200);
  await a.get(`/api/games/${id}/photos/1`).expect(403);
  await a.post(`/api/games/${id}/round`).send({ round: 0 }).expect(409);
  const run = (await a.post(`/api/games/${id}/round`).send({ round: 1 }).expect(200)).body;
  assert.ok(run.deadline > Date.now());
  await a.get(`/api/games/${id}/photos/1`).expect(200);
  await a
    .get(`/g/${id}`)
    .expect('X-Robots-Tag', /noindex/)
    .expect('Cache-Control', /no-store/);
  await a
    .get('/robots.txt')
    .expect(200)
    .expect((r) => assert.ok(!r.text.includes('Disallow: /g')));
  await owner.delete(`/api/games/${id}`).expect(200);
});
