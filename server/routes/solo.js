import path from 'node:path';
import { promises as fs } from 'node:fs';
import { cleanText, HttpError, publicGame, publicRun, roundDeadline, runGame } from '../game.js';
export function registerSoloRoutes(app, { store, requireCsrf, root }) {
  app.get('/api/games/:gameId', async (req, res) => {
    let run = await store.getRun(req.game.id, req.playerId);
    if (
      run &&
      !run.completed &&
      roundDeadline(req.game, run) &&
      Date.now() >= roundDeadline(req.game, run)
    )
      run = (
        await store.guess(req.game, req.playerId, { round: run.results.length, timedOut: true })
      ).run;
    if (publicGame(req.game).liveId) run = null;
    res.json({
      game: publicGame(runGame(req.game, run)),
      run: run ? publicRun(req.game, run) : null,
    });
  });
  app.post('/api/games/:gameId/join', async (req, res) => {
    if (publicGame(req.game).liveId) throw new HttpError(409, 'Join the live lobby for this trip.');
    const name = cleanText(req.body?.name, 24, 'Your name');
    const run = await store.join(req.game.id, req.playerId, name, req.game);
    res.json({ ...publicRun(req.game, run), game: publicGame(runGame(req.game, run)) });
  });
  app.post('/api/games/:gameId/round', requireCsrf, async (req, res) => {
    if (publicGame(req.game).liveId) throw new HttpError(409, 'Join the live lobby for this trip.');
    res.json(publicRun(req.game, await store.startRound(req.game, req.playerId, req.body?.round)));
  });
  app.get('/api/games/:gameId/photos/:round', async (req, res) => {
    const round = Number(req.params.round);
    const run = await store.getRun(req.game.id, req.playerId);
    const game = runGame(req.game, run);
    if (!Number.isInteger(round) || round < 0 || round >= game.photos.length)
      throw new HttpError(404, 'Photo not found.');
    if (
      !(req.user && req.user.uid === req.game.ownerUid) &&
      (!run ||
        round > run.results.length ||
        (game.settings?.timeLimitSeconds &&
          round === run.results.length &&
          run.roundStartedAt === null))
    )
      throw new HttpError(403, 'Join the game and start this round first.');
    if (publicGame(req.game).liveId && req.user?.uid !== req.game.ownerUid)
      throw new HttpError(403, 'Use the live lobby to view this round.');
    const photo = game.photos[run?.order?.[round] ?? round];
    const buffer = req.game.demo
      ? await fs.readFile(path.join(root, 'server', 'demo', photo.key))
      : await store.getPhoto(req.game.id, photo.key);
    res.type('jpeg').set('Cache-Control', 'private, no-store').send(buffer);
  });
  app.post('/api/games/:gameId/guess', async (req, res) => {
    if (publicGame(req.game).liveId)
      throw new HttpError(409, 'Submit your guess in the live lobby.');
    const { run, result } = await store.guess(req.game, req.playerId, req.body || {});
    res.json({ result, run: publicRun(req.game, run) });
  });
  app.get('/api/games/:gameId/leaderboard', async (req, res) => {
    const run = await store.getRun(req.game.id, req.playerId);
    res.json(await store.leaderboard(req.game.id, runGame(req.game, run).tripRevision || 0));
  });
}
