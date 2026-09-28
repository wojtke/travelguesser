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
    updateLive(g, id, { uid: game.ownerUid }, 'start', { round: 0 }),
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
