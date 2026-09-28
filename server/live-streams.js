import { canViewLive, expireLive, getLive, publicLive } from './live.js';
import { HttpError } from './game.js';
import { errorDetails } from './observability.js';
export function createLiveStreams(store, log = () => {}) {
  const rooms = new Map(),
    counts = new Map();
  let total = 0;
  return async function stream(req, res) {
    const actor = { uid: req.user?.uid, playerId: req.playerId },
      identity = actor.uid || actor.playerId;
    if (total >= 60 || (counts.get(identity) || 0) >= 2)
      throw new HttpError(429, 'Too many live connections. Close another game tab and retry.');
    if (req.game.sharing === false || !canViewLive(req.game, actor))
      throw new HttpError(403, 'Join this lobby first.');
    getLive(req.game, req.params.liveId);
    const key = `${req.game.id}:${req.params.liveId}`;
    total++;
    counts.set(identity, (counts.get(identity) || 0) + 1);
    let ownDraft;
    try {
      ownDraft = await store.getLiveDraft(req.game.id, req.params.liveId, actor.playerId);
    } catch (error) {
      total--;
      counts.set(identity, counts.get(identity) - 1);
      if (!counts.get(identity)) counts.delete(identity);
      throw error;
    }
    if (res.destroyed) {
      total--;
      counts.set(identity, counts.get(identity) - 1);
      if (!counts.get(identity)) counts.delete(identity);
      return;
    }
    res.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'private, no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 1000\n\n');
    let room = rooms.get(key),
      closed = false,
      heartbeat,
      lifetime;
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      clearTimeout(lifetime);
      total--;
      counts.set(identity, counts.get(identity) - 1);
      if (!counts.get(identity)) counts.delete(identity);
      room?.clients.delete(send);
      if (room && !room.clients.size) {
        room.unsubscribe?.();
        clearTimeout(room.timer);
        rooms.delete(key);
      }
      res.end();
    };
    const send = (game) => {
      if (closed) return;
      if (
        !game ||
        (game.status && game.status !== 'ready') ||
        game.sharing === false ||
        !canViewLive(game, actor) ||
        game.live?.id !== req.params.liveId ||
        game.live.expiresAt <= Date.now()
      ) {
        res.write(
          `event: unavailable\ndata: ${JSON.stringify({ reason: game?.live?.id === req.params.liveId && !canViewLive(game, actor) ? 'removed' : 'unavailable' })}\n\n`,
        );
        close();
        return;
      }
      const data = publicLive(game, actor);
      if (ownDraft?.round === game.live.round && !data.me?.guess)
        data.draft = { point: ownDraft.point, version: ownDraft.version, round: ownDraft.round };
      if (!res.write(`id: ${data.revision}\ndata: ${JSON.stringify(data)}\n\n`)) {
        close();
        return;
      }
      if (data.phase === 'finished') close();
    };
    send.close = close;
    if (!room) {
      room = { clients: new Set(), latest: null, timer: null };
      rooms.set(key, room);
      room.unsubscribe = store.watchGame(
        req.game.id,
        (game) => {
          room.latest = game;
          clearTimeout(room.timer);
          for (const callback of [...room.clients]) callback(game);
          const l = game?.live;
          if (room.clients.size && l?.id === req.params.liveId && game.sharing !== false) {
            const boundary =
              l.phase === 'preparing' ? l.startsAt : l.phase === 'round' ? l.deadline : null;
            const at = Math.min(boundary || l.expiresAt, l.expiresAt);
            room.timer = setTimeout(
              async () => {
                if (at === l.expiresAt) {
                  for (const callback of [...room.clients]) callback(null);
                  return;
                }
                try {
                  await store.mutateLive(game.id, l.id, (g, drafts) =>
                    expireLive(g, Date.now(), drafts),
                  );
                } catch (error) {
                  log({
                    event: 'live_transition_failed',
                    severity: 'ERROR',
                    ...errorDetails(error),
                  });
                  for (const callback of [...room.clients]) callback.close();
                }
              },
              Math.max(1, at - Date.now() + 5),
            );
          }
        },
        (error) => {
          log({ event: 'live_stream_failed', severity: 'ERROR', ...errorDetails(error) });
          for (const callback of [...room.clients]) callback.close();
        },
      );
    }
    room.clients.add(send);
    res.on('close', close);
    heartbeat = setInterval(() => {
      if (!res.write(': heartbeat\n\n')) close();
    }, 15000);
    lifetime = setTimeout(close, 45000);
    if (room.latest) send(room.latest);
  };
}
