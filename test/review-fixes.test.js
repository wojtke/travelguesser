import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { LocalStore } from '../server/store.js';
import { newRun } from '../server/game.js';
import { DEMO_RETENTION_MS } from '../server/demo-retention.js';
import { newLive, updateLive } from '../server/live.js';
import { testAuthentication } from './helpers.js';

test('rotating player cookies cannot bypass early network throttling or invoke authentication', async () => {
  let verifications = 0;
  const auth = testAuthentication();
  auth.verifySession = async () => {
    verifications++;
    return null;
  };
  const app = createApp({ auth, store: {}, rateLimitOptions: { networkLimit: 2 } });
  for (let i = 1; i <= 2; i++)
    await request(app)
      .get('/api/session')
      .set('Cookie', `tg_player=${String(i).repeat(64)}; tg_creator=test`)
      .expect(200);
  await request(app)
    .get('/api/session')
    .set('Cookie', `tg_player=${'3'.repeat(64)}; tg_creator=test`)
    .expect(429);
  assert.equal(verifications, 2);
  await request(app).get('/api/health').expect(200);
});

test('aggregate throttling also bounds requests from different networks', async () => {
  const app = createApp({
    auth: testAuthentication(),
    store: {},
    rateLimitOptions: { totalLimit: 2 },
  });
  for (let i = 1; i <= 2; i++)
    await request(app).get('/api/session').set('X-Forwarded-For', `192.0.2.${i}`).expect(200);
  await request(app).get('/api/session').set('X-Forwarded-For', '192.0.2.3').expect(429);
});

test('live polling limit rejects before loading a game from the database', async () => {
  let reads = 0;
  const game = newLive({ id: 'test-trip', ownerUid: 'owner', photos: [{ lat: 0, lng: 0 }] });
  const app = createApp({
    auth: testAuthentication(),
    store: {
      getGame: async () => {
        reads++;
        return game;
      },
    },
    rateLimitOptions: { liveLimit: 1 },
  });
  const guest = request.agent(app),
    url = `/api/games/test-trip/live/${game.live.id}`;
  await guest.get(url).expect(200);
  await guest.get(url).expect(429);
  assert.equal(reads, 1);
});

test('removed players cannot read current/future photos or group results', async () => {
  const owner = { uid: 'owner', playerId: 'host' },
    removed = { playerId: 'removed' },
    remaining = { playerId: 'remaining' };
  let game = newLive({
    id: 'test-trip',
    ownerUid: 'owner',
    photos: [
      { key: '0.jpg', lat: 0, lng: 0 },
      { key: '1.jpg', lat: 0, lng: 0 },
    ],
  });
  for (const actor of [removed, remaining])
    game = updateLive(game, game.live.id, actor, 'join', { name: actor.playerId });
  game = updateLive(game, game.live.id, owner, 'start', { round: 0 });
  game = updateLive(game, game.live.id, owner, 'remove', {
    playerId: game.live.players.removed.id,
  });
  game = updateLive(game, game.live.id, remaining, 'guess', { round: 0, lat: 0, lng: 0 });
  // Use the same hashed identity the middleware assigns to a known test cookie.
  const { createHash } = await import('node:crypto');
  const sid = 'a'.repeat(64),
    key = createHash('sha256').update(sid).digest('hex');
  game.live.players[key] = game.live.players.removed;
  delete game.live.players.removed;
  let photos = 0;
  const app = createApp({
    auth: testAuthentication(),
    rateLimits: false,
    store: {
      getGame: async () => game,
      getPhoto: async () => {
        photos++;
        return Buffer.from('photo');
      },
    },
  });
  const guest = request.agent(app).set('Cookie', `tg_player=${sid}`),
    url = `/api/games/test-trip/live/${game.live.id}`;
  const state = (await guest.get(url).expect(200)).body;
  assert.equal(state.joined, false);
  assert.equal(state.photoUrl, null);
  assert.deepEqual(state.results, []);
  assert.deepEqual(state.players, []);
  await guest.get(`${url}/photos/0`).expect(403);
  game = updateLive(game, game.live.id, owner, 'next', { round: 0 });
  await guest.get(`${url}/photos/1`).expect(403);
  assert.equal(photos, 0);
});

test('expired demo progress is hidden and cleared on the next write; user trips are retained', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tripguessr-retention-'));
  try {
    const store = new LocalStore(directory),
      demo = { id: 'demo-trip', photos: [{ lat: 0, lng: 0 }] };
    const old = newRun(demo, 'Old demo', Date.now() - DEMO_RETENTION_MS - 1000);
    await store.mutate((d) => {
      d.runs['demo-trip:guest'] = {
        ...old,
        completed: true,
        score: 5000,
        finishedAt: old.startedAt,
      };
      d.runs['user-trip:guest'] = { ...old, gameId: 'user-trip', demoExpiresAt: undefined };
    });
    assert.equal(await store.getRun(demo.id, 'guest'), null);
    assert.deepEqual(await store.leaderboard(demo.id), []);
    assert.ok(await store.getRun('user-trip', 'guest'));
    await assert.rejects(store.guess(demo, 'guest', { round: 0, lat: 0, lng: 0 }), { status: 403 });
    const fresh = await store.join(demo.id, 'guest', 'Fresh demo', demo);
    assert.equal(fresh.score, 0);
    assert.equal(fresh.name, 'Fresh demo');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a full lobby sharing one network can poll at the normal cadence', async () => {
  const game = newLive({ id: 'test-trip', ownerUid: 'owner', photos: [{ lat: 0, lng: 0 }] });
  const app = createApp({ auth: testAuthentication(), store: { getGame: async () => game } });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const url = `/api/games/test-trip/live/${game.live.id}`;
  try {
    await Promise.all(
      Array.from({ length: 20 }, async (_, i) => {
        const sid = i.toString(16).padStart(64, '0');
        for (let poll = 0; poll < 21; poll++)
          await request(server).get(url).set('Cookie', `tg_player=${sid}`).expect(200);
      }),
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
