import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { LocalStore } from '../server/store.js';
import { createApp } from '../server/app.js';
import { testAuthentication, signIn } from './helpers.js';
import { newLive, updateLive, expireLive, publicLive, validateDraft } from '../server/live.js';
import { gameSettings, newRun, applyGuess, beginRound } from '../server/game.js';
import { publicSharedResult } from '../server/results.js';
const host = { uid: 'creator-owner', playerId: 'host' },
  a = { playerId: 'a' },
  b = { playerId: 'b' };
const fixture = (settings = {}) => {
  let g = newLive(
    {
      id: 'v2-test-trip',
      ownerUid: 'creator-owner',
      title: 'Trip',
      hostName: 'Host',
      photos: [
        { lat: 10, lng: 20, key: '0.jpg', caption: 'secret' },
        { lat: 0, lng: 0, key: '1.jpg' },
      ],
    },
    settings,
    1000,
  );
  for (const p of [a, b]) g = updateLive(g, g.live.id, p, 'join', { name: p.playerId }, 1100);
  return g;
};
test('v2 has a shared five-second start, spectator host and readiness never extends it', () => {
  let g = fixture({ timeLimitSeconds: 7 });
  const id = g.live.id;
  g = updateLive(g, id, host, 'start', { round: 0 }, 2000);
  assert.equal(g.live.phase, 'preparing');
  assert.equal(g.live.startsAt, 7000);
  assert.equal(g.live.deadline, 14000);
  assert.equal(g.live.players.host, undefined);
  assert.throws(() => updateLive(g, id, a, 'guess', { round: 0, lat: 10, lng: 20 }, 6999), {
    status: 409,
  });
  g = updateLive(g, id, a, 'ready', { round: 0 }, 3000);
  assert.equal(g.live.startsAt, 7000);
  assert.equal(g.live.players.b.ready, false);
  assert.equal(expireLive(g, 7000).live.phase, 'round');
  for (const actor of [host, a, b]) {
    const s = publicLive(g, actor, 3000);
    assert.equal(s.startsAt, 7000);
    assert.ok(s.photoUrl);
    assert.deepEqual(s.results, []);
  }
});
test('latest saved pin counts at timeout, locked guesses win and drafts stay private', () => {
  let g = fixture({ timeLimitSeconds: 1 });
  const id = g.live.id;
  g = updateLive(g, id, host, 'start', { round: 0 }, 2000);
  const d = validateDraft(g, id, a, { round: 0, version: 2, lat: 10, lng: 20 }, null, 7100);
  assert.equal(validateDraft(g, id, a, { round: 0, version: 1, lat: 0, lng: 0 }, d, 7200), d);
  assert.ok(!JSON.stringify(publicLive(g, b, 7300)).includes('"lat"'));
  g = expireLive(g, 8000, { a: d });
  assert.equal(g.live.players.a.score, 5000);
  assert.equal(g.live.players.b.score, 0);
  assert.equal(g.live.players.a.results[0].automatic, true);
  assert.equal(g.live.players.a.results[0].durationMs, 1000);
  assert.equal(expireLive(g, 9000, { a: d }), g);
  assert.throws(() => validateDraft(g, id, a, { round: 0, version: 3, lat: 0, lng: 0 }, d, 8100), {
    status: 409,
  });
  g = updateLive(g, id, host, 'next', { round: 0 }, 9000);
  assert.throws(() => validateDraft(g, id, a, { round: 0, version: 4, lat: 0, lng: 0 }, d, 14100), {
    status: 409,
  });
  g = updateLive(g, id, a, 'guess', { round: 1, lat: 0, lng: 0 }, 14100);
  g = expireLive(g, 15000, { a: { round: 1, point: { lat: 80, lng: 80 } }, b: d });
  assert.equal(g.live.players.a.score, 10000);
  assert.equal(g.live.players.b.score, 0);
});
test('first-confirmation timer starts exactly once; players may advance but cannot moderate', () => {
  let g = fixture({
    timerMode: 'afterFirstLock',
    afterFirstLockSeconds: 3,
    nextRoundControl: 'anyPlayer',
  });
  const id = g.live.id;
  assert.throws(() => updateLive(g, id, a, 'start', { round: 0 }, 2000), { status: 403 });
  g = updateLive(g, id, host, 'start', { round: 0 }, 2000);
  assert.equal(g.live.deadline, null);
  g = expireLive(g, 50000);
  assert.equal(g.live.phase, 'round');
  g = updateLive(g, id, a, 'guess', { round: 0, lat: 10, lng: 20 }, 51000);
  assert.equal(g.live.deadline, 54000);
  g = updateLive(g, id, a, 'guess', { round: 0, lat: 0, lng: 0 }, 52000);
  assert.equal(g.live.deadline, 54000);
  assert.throws(() => updateLive(g, id, b, 'reveal', { round: 0 }, 52000), { status: 403 });
  g = expireLive(g, 54000);
  g = updateLive(g, id, b, 'next', { round: 0 }, 55000);
  assert.equal(g.live.round, 1);
  assert.equal(g.live.startsAt, 60000);
  assert.equal(updateLive(g, id, a, 'next', { round: 0 }, 55001), g);
});
test('timer inputs validate the full supported range and keep no-limit explicit', () => {
  for (const value of [1, 7, 3600])
    assert.equal(gameSettings({ timeLimitSeconds: value }).timeLimitSeconds, value);
  for (const value of [-1, 0.5, 3601, '30', NaN])
    assert.throws(() => gameSettings({ timeLimitSeconds: value }), { status: 400 });
  assert.equal(gameSettings({ timerMode: 'none', timeLimitSeconds: 30 }).timeLimitSeconds, 0);
  assert.throws(() => gameSettings({ mode: 'solo', timerMode: 'afterFirstLock' }), { status: 400 });
});
test('solo summaries record shuffled photo identity and guessing time excludes the break', () => {
  const game = fixture();
  let run = newRun(game, 'Solo', 1000);
  run.order = [1, 0];
  run = applyGuess(game, run, { round: 0, lat: 0, lng: 0 }, 2500).run;
  run = beginRound(run, 1, 30000);
  run = applyGuess(game, run, { round: 1, lat: 10, lng: 20 }, 32000).run;
  assert.deepEqual(
    run.results.map((r) => r.photoIndex),
    [1, 0],
  );
  assert.deepEqual(
    run.results.map((r) => r.durationMs),
    [1500, 2000],
  );
});
test('shared snapshots are idempotent, spoiler-free, expire and respect pause/delete', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tg-shares-'));
  try {
    const store = new LocalStore(dir),
      game = { ...fixture(), status: 'ready' };
    delete game.live;
    await store.mutate((d) => {
      d.games[game.id] = game;
    });
    await store.join(game.id, a.playerId, 'Alice', game);
    await assert.rejects(store.createSharedResult(game.id, a, 'solo'), { status: 409 });
    await store.guess(game, a.playerId, { round: 0, lat: 10, lng: 20 });
    await store.startRound(game, a.playerId, 1);
    await store.guess(game, a.playerId, { round: 1, lat: 0, lng: 0 });
    const first = await store.createSharedResult(game.id, a, 'solo'),
      again = await store.createSharedResult(game.id, a, 'solo');
    assert.equal(first.token, again.token);
    assert.equal(
      new Date(first.record.expiresAt).getTime(),
      new Date(again.record.expiresAt).getTime(),
    );
    const text = JSON.stringify(publicSharedResult(first.record));
    for (const field of ['lat', 'lng', 'caption', 'guess', 'ownerPlayerId', 'source'])
      assert.ok(!text.includes(`"${field}"`));
    await assert.rejects(store.createSharedResult(game.id, b, 'solo'), { status: 409 });
    const app = createApp({ store, auth: testAuthentication(), rateLimits: false }),
      owner = request.agent(app);
    await signIn(owner, 'creator-owner');
    const url = `/api/games/${game.id}/results/${first.token}`;
    await request(app)
      .get(url)
      .expect(200)
      .expect('Cache-Control', /no-store/)
      .expect('X-Robots-Tag', /noindex/);
    await store.mutateGame(game.id, (g) => ({ ...g, sharing: false }));
    await owner.get(url).expect(403);
    await store.mutateGame(game.id, (g) => ({ ...g, sharing: true }));
    await store.mutate((d) => {
      d.sharedResults[`${game.id}:${first.token}`].expiresAt = new Date(0);
    });
    await request(app).get(url).expect(404);
    await store.deleteGame(game.id, host.uid);
    await request(app).get(url).expect(404);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('automatic titles are allocated at publication and never reused after deletion', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tg-names-'));
  try {
    const store = new LocalStore(dir);
    for (const [id, number] of [
      ['auto-one', 1],
      ['auto-two', 2],
    ]) {
      await store.beginGame({
        id,
        ownerUid: 'owner',
        autoTitle: true,
        titleFirstName: 'Alice Example',
        title: 'placeholder',
        photos: [],
        createdAt: Date.now(),
      });
      const g = await store.publishGame(id, 'owner', 1);
      assert.equal(g.title, `Alice’s trip #${number}`);
      await store.deleteGame(id, 'owner');
    }
    assert.equal((await store.getUsage('owner')).nextTripNumber, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
