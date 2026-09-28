import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Firestore } from '@google-cloud/firestore';
import { CloudStore } from '../../server/store.js';
import { newRun } from '../../server/game.js';
import { DEMO_RETENTION_MS } from '../../server/demo-retention.js';
import { newLive, updateLive, publicLive } from '../../server/live.js';

if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || ''))
  throw new Error('Tests require a local Firestore emulator. Production access is forbidden.');
const db = new Firestore({ projectId: 'demo-tripguessr-review' }),
  deleted = [];
const store = new CloudStore({
  db,
  bucket: { deleteFiles: async (options) => deleted.push(options.prefix) },
});
after(async () => {
  for (const collection of ['games', 'creators'])
    await db.recursiveDelete(db.collection(collection));
  await new Promise((resolve) => setTimeout(resolve, 250));
  await db.terminate();
});
const fixture = (id, ownerUid = 'owner') => ({
  id,
  ownerUid,
  title: 'Synthetic test',
  hostName: 'Host',
  photos: [{ key: '0.jpg', lat: 0, lng: 0 }],
  createdAt: Date.now(),
});
async function publish(game) {
  await store.beginGame(game);
  return store.publishGame(game.id, game.ownerUid, 10);
}

test('Firestore retries concurrent guesses without double scoring and recursively deletes gameplay data', async () => {
  const game = await publish(fixture('concurrent-trip'));
  await Promise.all([
    store.join(game.id, 'player', 'Player', game),
    store.join(game.id, 'player', 'Player', game),
  ]);
  const guesses = await Promise.all([
    store.guess(game, 'player', { round: 0, lat: 0, lng: 0 }),
    store.guess(game, 'player', { round: 0, lat: 0, lng: 0 }),
  ]);
  assert.deepEqual(
    guesses.map((g) => g.run.score),
    [5000, 5000],
  );
  assert.equal((await store.leaderboard(game.id)).length, 1);
  await assert.rejects(store.deleteGame(game.id, 'other-owner'), { status: 403 });
  await store.deleteGame(game.id, game.ownerUid);
  assert.equal(await store.getGame(game.id), null);
  assert.equal(await store.getRun(game.id, 'player'), null);
  assert.deepEqual(await store.leaderboard(game.id), []);
  assert.equal((await store.getUsage(game.ownerUid)).trips, 0);
  assert.ok(deleted.includes(`games/${game.id}/`));
});

test('Firestore quota transactions admit at most five concurrent uploads', async () => {
  const attempts = await Promise.allSettled(
    Array.from({ length: 7 }, (_, i) => store.beginGame(fixture(`quota-trip-${i}`, 'quota-owner'))),
  );
  assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 5);
  assert.ok(attempts.filter((r) => r.status === 'rejected').every((r) => r.reason.status === 409));
  assert.equal((await store.getUsage('quota-owner')).trips, 5);
});

test('Firestore live updates preserve concurrent players and guesses', async () => {
  let game = await publish(fixture('live-trip'));
  game = await store.mutateGame(game.id, (g) => newLive(g));
  const id = game.live.id;
  await Promise.all(
    ['a', 'b'].map((playerId) =>
      store.mutateGame(game.id, (g) => updateLive(g, id, { playerId }, 'join', { name: playerId })),
    ),
  );
  await store.mutateGame(game.id, (g) =>
    updateLive(g, id, { uid: game.ownerUid }, 'start', { round: 0 }, Date.now() - 5100),
  );
  await Promise.all(
    ['a', 'b'].map((playerId) =>
      store.mutateGame(game.id, (g) =>
        updateLive(g, id, { playerId }, 'guess', { round: 0, lat: 0, lng: 0 }),
      ),
    ),
  );
  const state = publicLive(await store.getGame(game.id), { playerId: 'a' });
  assert.equal(state.phase, 'results');
  assert.deepEqual(
    state.results.map((r) => r.score),
    [5000, 5000],
  );
});

test('Firestore hides expired demos before TTL deletion and expires both progress and scores', async () => {
  const game = fixture('demo-trip'),
    old = newRun(game, 'Expired', Date.now() - DEMO_RETENTION_MS - 1000);
  await store.runRef(game.id, 'old').set(old);
  await store.gameRef(game.id).collection('leaderboard').doc('old').set({
    name: 'Expired',
    score: 15000,
    finishedAt: old.startedAt,
    demoExpiresAt: old.demoExpiresAt,
  });
  assert.equal(await store.getRun(game.id, 'old'), null);
  assert.deepEqual(await store.leaderboard(game.id), []);
  await assert.rejects(store.guess(game, 'old', { round: 0, lat: 0, lng: 0 }), { status: 403 });
  const run = await store.join(game.id, 'old', 'Fresh', game);
  assert.equal(run.score, 0);
  assert.equal(
    (await store.gameRef(game.id).collection('leaderboard').doc('old').get()).exists,
    false,
  );
  await store.guess(game, 'old', { round: 0, lat: 0, lng: 0 });
  const score = (await store.gameRef(game.id).collection('leaderboard').doc('old').get()).data();
  assert.equal(score.demoExpiresAt.toMillis(), run.demoExpiresAt.getTime());
  assert.equal((await store.leaderboard(game.id))[0].name, 'Fresh');
});

test('Firestore draft versions serialize with timeout, sharing is idempotent, and separate instances receive updates', async () => {
  const { createLiveStreams } = await import('../../server/live-streams.js');
  const { EventEmitter } = await import('node:events');
  const { expireLive } = await import('../../server/live.js');
  const secondStore = new CloudStore({ db, bucket: {} });
  let game = await publish({
    ...fixture('v2-firestore-trip', 'v2-owner'),
    settings: { mode: 'live', timeLimitSeconds: 60 },
  });
  game = await store.mutateGame(game.id, (g) => newLive(g));
  const id = game.live.id,
    actor = { playerId: 'a' };
  await store.mutateLive(game.id, id, (g, d) =>
    updateLive(g, id, actor, 'join', { name: 'A' }, Date.now(), d),
  );
  game = await store.mutateLive(game.id, id, (g, d) =>
    updateLive(g, id, { uid: 'v2-owner' }, 'start', { round: 0 }, Date.now() - 5100, d),
  );
  class Res extends EventEmitter {
    states = [];
    status() {
      return this;
    }
    set() {
      return this;
    }
    flushHeaders() {}
    write(s) {
      if (s.startsWith('id:')) this.states.push(JSON.parse(s.split('data: ')[1]));
      return true;
    }
    end() {
      this.ended = true;
    }
  }
  const responses = [new Res(), new Res()];
  await Promise.all(
    [store, secondStore].map((s, i) =>
      createLiveStreams(s)({ game, params: { liveId: id }, playerId: 'a' }, responses[i]),
    ),
  );
  try {
    await Promise.all(
      [1, 3, 2].map((version) =>
        store.saveLiveDraft(game.id, id, actor, { round: 0, version, lat: 0, lng: 0 }),
      ),
    );
    assert.equal((await secondStore.getLiveDraft(game.id, id, 'a')).version, 3);
    await store.mutateLive(game.id, id, (g, d) => expireLive(g, g.live.deadline, d));
    const until = Date.now() + 5000;
    while (!responses.every((r) => r.states.at(-1)?.phase === 'results') && Date.now() < until)
      await new Promise((r) => setTimeout(r, 20));
    assert.ok(responses.every((r) => r.states.at(-1)?.results[0].score === 5000));
    await store.mutateLive(game.id, id, (g, d) =>
      updateLive(g, id, { uid: 'v2-owner' }, 'next', { round: 0 }, Date.now(), d),
    );
    const shares = await Promise.all(
      [store, secondStore].map((s) => s.createSharedResult(game.id, actor, id)),
    );
    assert.equal(shares[0].token, shares[1].token);
    await store.mutateGame(game.id, (g) => newLive(g));
    assert.ok(await store.getSharedResult(game.id, shares[0].token));
    await store.deleteGame(game.id, 'v2-owner');
    assert.equal(await store.getSharedResult(game.id, shares[0].token), null);
    assert.equal(await store.getLiveDraft(game.id, id, 'a'), null);
  } finally {
    for (const res of responses) res.emit('close');
  }
});
