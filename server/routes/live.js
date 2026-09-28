import { createLiveStreams } from '../live-streams.js';
import { HttpError } from '../game.js';
import { expireLive, getLive, newLive, publicLive, updateLive } from '../live.js';
export function registerLiveRoutes(app, { store, requireCreator, requireCsrf, log }) {
  app.get('/api/games/:gameId/live/:liveId/events', createLiveStreams(store, log));
  app.post('/api/games/:gameId/live/:liveId/draft', requireCsrf, async (req, res) => {
    const draft = await store.saveLiveDraft(
      req.game.id,
      req.params.liveId,
      { uid: req.user?.uid, playerId: req.playerId },
      req.body || {},
    );
    res.json({
      point: draft.point,
      version: draft.version,
      round: draft.round,
      savedAt: draft.savedAt,
    });
  });
  const liveActor = (req) => ({ uid: req.user?.uid, playerId: req.playerId });
  const checkedLive = (game, id) => {
    if (game.sharing === false)
      throw new HttpError(403, 'Sharing is paused. Re-enable it to use the live lobby.');
    getLive(game, id);
  };
  app.post('/api/games/:gameId/live', requireCreator, requireCsrf, async (req, res) => {
    const game = await store.mutateGame(req.game.id, (g) => {
      if (g.ownerUid !== req.user.uid)
        throw new HttpError(403, 'Only the trip creator can open a lobby.');
      if (g.sharing === false)
        throw new HttpError(409, 'Enable link sharing before opening a lobby.');
      return newLive(g, req.body || {});
    });
    res.json(publicLive(game, liveActor(req)));
  });
  app.get('/api/games/:gameId/live/:liveId', async (req, res) => {
    checkedLive(req.game, req.params.liveId);
    let game = req.game;
    if (expireLive(game) !== game)
      game = await store.mutateLive(game.id, req.params.liveId, (g, drafts) => {
        checkedLive(g, req.params.liveId);
        return expireLive(g, Date.now(), drafts);
      });
    const data = publicLive(game, liveActor(req));
    if (data.joined && game.live.protocolVersion === 2) {
      const draft = await store.getLiveDraft(game.id, game.live.id, req.playerId);
      if (draft?.round === game.live.round && !data.me?.guess)
        data.draft = { point: draft.point, version: draft.version, round: draft.round };
    }
    res.json(data);
  });
  app.post('/api/games/:gameId/live/:liveId/:action', requireCsrf, async (req, res) => {
    const game = await store.mutateLive(req.game.id, req.params.liveId, (g, drafts) => {
      checkedLive(g, req.params.liveId);
      return updateLive(
        g,
        req.params.liveId,
        liveActor(req),
        req.params.action,
        req.body || {},
        Date.now(),
        drafts,
      );
    });
    res.json(publicLive(game, liveActor(req)));
  });
  app.get('/api/games/:gameId/live/:liveId/photos/:round', async (req, res) => {
    checkedLive(req.game, req.params.liveId);
    const l = req.game.live,
      p = l.players[req.playerId],
      round = Number(req.params.round);
    if (
      (!p?.active && req.user?.uid !== req.game.ownerUid) ||
      l.phase === 'lobby' ||
      !Number.isInteger(round) ||
      round < 0 ||
      round > l.round
    )
      throw new HttpError(403, 'This photo is not available yet.');
    const photo = req.game.photos[l.order[round]];
    const buffer = await store.getPhoto(req.game.id, photo.key);
    res.type('jpeg').set('Cache-Control', 'private, no-store').send(buffer);
  });
}
