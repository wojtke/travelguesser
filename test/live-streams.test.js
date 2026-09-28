import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createLiveStreams } from '../server/live-streams.js';
import { newLive, updateLive } from '../server/live.js';
export class Response extends EventEmitter {
  chunks = [];
  ended = false;
  status() {
    return this;
  }
  set(headers) {
    this.headers = headers;
    return this;
  }
  flushHeaders() {}
  write(s) {
    this.chunks.push(s);
    return true;
  }
  end() {
    this.ended = true;
  }
  states() {
    return this.chunks
      .filter((s) => s.startsWith('id:'))
      .map((s) => JSON.parse(s.split('data: ')[1]));
  }
}
function fixture() {
  let g = newLive({ id: 'stream-trip', ownerUid: 'owner', photos: [{ lat: 0, lng: 0 }] });
  for (const id of ['a', 'b']) g = updateLive(g, g.live.id, { playerId: id }, 'join', { name: id });
  return g;
}
const req = (g, id) => ({ game: g, params: { liveId: g.live.id }, playerId: id });
test('SSE shares one listener, isolates drafts, rejects excess tabs, revokes access and cleans up', async () => {
  let game = fixture(),
    callback,
    watches = 0,
    unwatches = 0;
  const store = {
    getLiveDraft: async (id, liveId, p) => ({
      round: 0,
      version: 1,
      point: { lat: p === 'a' ? 12 : 34, lng: 0 },
    }),
    watchGame: (id, cb) => {
      watches++;
      callback = cb;
      queueMicrotask(() => cb(game));
      return () => {
        unwatches++;
      };
    },
  };
  const stream = createLiveStreams(store),
    a = new Response(),
    b = new Response();
  await Promise.all([stream(req(game, 'a'), a), stream(req(game, 'b'), b)]);
  assert.equal(watches, 1);
  assert.equal(a.states().at(-1).draft.point.lat, 12);
  assert.equal(b.states().at(-1).draft.point.lat, 34);
  assert.ok(!a.chunks.join('').includes('"lat":34'));
  const second = new Response();
  await stream(req(game, 'a'), second);
  await assert.rejects(stream(req(game, 'a'), new Response()), { status: 429 });
  game = updateLive(game, game.live.id, { uid: 'owner' }, 'remove', {
    playerId: game.live.players.b.id,
  });
  callback(game);
  assert.equal(b.ended, true);
  assert.ok(b.chunks.join('').includes('"reason":"removed"'));
  assert.equal(unwatches, 0);
  a.emit('close');
  second.emit('close');
  assert.equal(unwatches, 1);
});
test('SSE concurrent admission caps apply before async reads and finish/pause stop streaming', async () => {
  const game = fixture();
  let reads = 0,
    callback;
  const stream = createLiveStreams({
    getLiveDraft: async () => {
      reads++;
      await new Promise((r) => setTimeout(r, 5));
      return null;
    },
    watchGame: (id, cb) => {
      callback = cb;
      queueMicrotask(() => cb(game));
      return () => {};
    },
  });
  const responses = Array.from({ length: 6 }, () => new Response());
  const attempts = await Promise.allSettled(responses.map((res) => stream(req(game, 'a'), res)));
  assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 2);
  assert.equal(reads, 2);
  callback({ ...game, sharing: false });
  assert.ok(responses.slice(0, 2).every((r) => r.ended));
  const final = new Response();
  await stream(req(game, 'a'), final);
  callback({ ...game, live: { ...game.live, phase: 'finished' } });
  assert.equal(final.ended, true);
});

test('SSE connection lifetime, heartbeat and admission cleanup are bounded', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: Date.now() });
  const game = fixture();
  let callback,
    unwatched = 0;
  const stream = createLiveStreams({
      getLiveDraft: async () => null,
      watchGame: (_id, cb) => {
        callback = cb;
        return () => {
          unwatched++;
        };
      },
    }),
    res = new Response();
  await stream(req(game, 'a'), res);
  callback(game);
  t.mock.timers.tick(15000);
  assert.ok(res.chunks.some((c) => c.includes('heartbeat')));
  t.mock.timers.tick(30000);
  assert.equal(res.ended, true);
  assert.equal(unwatched, 1);
  const reconnect = new Response();
  await stream(req(game, 'a'), reconnect);
  callback(game);
  assert.equal(reconnect.states().length, 1);
  reconnect.emit('close');
  assert.equal(unwatched, 2);
});
test('60-stream instance cap leaves command capacity and releases slots when tabs close', async () => {
  const stream = createLiveStreams({ getLiveDraft: async () => null, watchGame: () => () => {} }),
    open = [];
  try {
    for (let i = 0; i < 60; i++) {
      const game = fixture();
      game.id = `stream-room-${i}`;
      const res = new Response(),
        r = req(game, 'a');
      r.user = { uid: `creator-${i}` };
      await stream(r, res);
      open.push(res);
    }
    const game = fixture(),
      r = req(game, 'b');
    await assert.rejects(stream(r, new Response()), { status: 429 });
    open.pop().emit('close');
    const res = new Response();
    await stream(r, res);
    open.push(res);
  } finally {
    for (const res of open) res.emit('close');
  }
});
