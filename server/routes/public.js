import express from 'express';
import rateLimit from 'express-rate-limit';
import { privateNetworkKey } from '../request-limits.js';
import { HttpError } from '../game.js';
import { createPublicService } from '../public-service.js';
import {
  publicEdition,
  publicCredits,
  decodeCursor,
  encodeCursor,
  normalize,
  alive,
} from '../public-content.js';
import { publicSharedResult } from '../results.js';
import { publicLive, updateLive, expireLive } from '../live.js';
import { createLiveStreams } from '../live-streams.js';
import { registerCommunityAdmin } from './public-admin.js';

export function registerPublicRoutes(
  app,
  { store, requireCreator, requireCsrf, log, rateLimits, publicEnabled, adminUids },
) {
  app.param('publicationId', (_req, _res, next, id) =>
    /^[\w-]{8,40}$/.test(id) ? next() : next(new HttpError(404, 'Trip not found.')),
  );
  const s = createPublicService(store, log),
    { data } = s;
  const cache = new Map(),
    boardCache = new Map();
  const clearCache = () => {
    cache.clear();
    boardCache.clear();
  };
  const isAdmin = (req) => !!req.user && adminUids.includes(req.user.uid);
  const enabled = (req, _res, next) =>
    publicEnabled || isAdmin(req)
      ? next()
      : next(new HttpError(404, 'Public trips are not available yet.'));
  app.get('/api/community/config', (req, res) =>
    res.json({
      enabled: publicEnabled,
      admin: isAdmin(req),
      supportEmail: process.env.PUBLIC_SUPPORT_EMAIL || null,
    }),
  );
  const writeLimit = rateLimits
    ? rateLimit({
        keyGenerator: privateNetworkKey,
        windowMs: 3600_000,
        limit: 60,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
      })
    : (_req, _res, next) => next();
  app.post(
    '/api/games/:gameId/publication',
    enabled,
    requireCreator,
    requireCsrf,
    writeLimit,
    async (req, res) => {
      const published = await s.publish(req.params.gameId, req.user.uid, req.body || {});
      clearCache();
      res.status(201).json(published);
    },
  );
  app.get('/api/games/:gameId/publication', requireCreator, async (req, res) => {
    const g = await store.getGame(req.params.gameId);
    if (!g || g.ownerUid !== req.user.uid)
      throw new HttpError(403, 'This trip belongs to another creator.');
    const p = g.publicationId ? await data.get(`publications/${g.publicationId}`) : null;
    res.json(p ? { ...publicEdition(p), state: p.state, reason: p.moderationReason || '' } : null);
  });
  app.delete('/api/publications/:publicationId', requireCreator, requireCsrf, async (req, res) => {
    await s.unpublish(req.params.publicationId, req.user.uid);
    clearCache();
    res.json({ removed: true });
  });
  app.get('/api/catalog', enabled, async (req, res) => {
    const q = normalize(req.query.q),
      kind = String(req.query.kind || ''),
      cursor = decodeCursor(req.query.cursor);
    if (
      q.length > 40 ||
      (q && q.length < 2) ||
      !['', 'community', 'official', 'daily'].includes(kind)
    )
      throw new HttpError(400, 'Search with 2–40 characters and a valid category.');
    const cacheKey = JSON.stringify([q, kind, cursor]),
      cached = cache.get(cacheKey);
    if (cached && cached.until > Date.now()) return res.json(cached.value);
    const filters = [
      ['state', '==', 'published'],
      ['publishedAt', '<=', Date.now()],
    ];
    if (q) filters.push(['searchPrefixes', 'array-contains', q]);
    if (kind) filters.push(['kind', '==', kind]);
    const rows = await data.list('publications', {
      filters,
      order: 'publishedAt',
      cursor,
      limit: 20,
    });
    const checked = await Promise.all(
      rows.map(async (p) => {
        try {
          await s.edition(p.id);
          return publicEdition(p);
        } catch (e) {
          if (e.status === 404) return null;
          throw e;
        }
      }),
    );
    const value = {
      items: checked.filter(Boolean),
      cursor: rows.length === 20 ? encodeCursor(rows.at(-1), 'publishedAt') : null,
    };
    if (cache.size >= 100) cache.delete(cache.keys().next().value);
    const midnight = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) + 86400_000;
    cache.set(cacheKey, { value, until: Math.min(Date.now() + 30_000, midnight) });
    res.json(value);
  });
  app.get('/api/daily', enabled, async (_req, res) => {
    const date = new Date().toISOString().slice(0, 10),
      entry = await data.get(`dailyChallenges/${date}`);
    let trip = null;
    if (entry)
      try {
        trip = publicEdition(await s.edition(entry.publicationId));
      } catch (e) {
        if (!e.status) throw e;
      }
    if (!trip) log({ event: 'daily_unavailable', severity: 'WARNING' });
    res.json({ date, trip, resetsAt: Date.parse(`${date}T00:00:00Z`) + 86400_000 });
  });
  app.get('/api/public-profile', requireCreator, async (req, res) => {
    const p = await data.get(s.profilePath(req.user.uid));
    const scores = await data.list(`${s.profilePath(req.user.uid)}/scores`, {
      cursor: decodeCursor(req.query.cursor),
    });
    res.json({
      nickname: p?.nickname || '',
      suspended: !!p?.suspended,
      notice: p?.moderationReason || '',
      activeRoom: p?.activeRoom || null,
      scores,
      cursor: scores.length === 20 ? encodeCursor(scores.at(-1), 'createdAt') : null,
    });
  });
  app.delete(
    '/api/publications/:publicationId/leaderboard/me',
    requireCreator,
    requireCsrf,
    async (req, res) => {
      if (await data.get(`publications/${req.params.publicationId}`))
        await s.withdraw(req.params.publicationId, req.user.uid);
      clearCache();
      res.json({ withdrawn: true });
    },
  );
  const router = express.Router({ mergeParams: true });
  app.use('/api/publications/:publicationId', enabled, router);
  router.use(async (req, _res, next) => {
    if (!/^[\w-]{8,40}$/.test(req.params.publicationId))
      throw new HttpError(404, 'Trip not found.');
    req.publication = await s.edition(req.params.publicationId);
    next();
  });
  router.get('/', async (req, res) => {
    const { p, run } = await s.updateRun(req.publication.id, s.actor(req), 'get');
    const profile = req.user ? await data.get(s.profilePath(req.user.uid)) : null;
    res.json({
      game: {
        ...publicEdition(p),
        canRank: await s.eligibility(p, s.actor(req)),
        nickname: profile?.nickname || '',
        signedIn: !!req.user,
      },
      run: s.runView(p, run),
    });
  });
  router.post('/join', requireCsrf, async (req, res) =>
    res.json(await s.join(req.publication.id, s.actor(req), req.body || {})),
  );
  for (const op of ['round', 'guess'])
    router.post(`/${op}`, requireCsrf, async (req, res) => {
      const { p, run, result } = await s.updateRun(
        req.publication.id,
        s.actor(req),
        op,
        req.body || {},
      );
      const view = s.runView(p, run);
      if (run.completed) boardCache.clear();
      res.json(
        op === 'guess'
          ? {
              result: result
                ? { ...result, credit: publicCredits(p.photos[result.photoIndex]) }
                : null,
              run: view,
            }
          : view,
      );
    });
  router.get('/photos/:round', async (req, res) => {
    const p = req.publication,
      run = await data.get(s.path(p.id, 'publicRuns', s.actorKey(s.actor(req)))),
      round = Number(req.params.round);
    if (
      !alive(run) ||
      !Number.isInteger(round) ||
      round < 0 ||
      round >= p.photos.length ||
      round > run.results.length ||
      (round === run.results.length && run.roundStartedAt === null)
    )
      throw new HttpError(403, 'Start this round first.');
    res
      .type('jpeg')
      .set('Cache-Control', 'private, no-store')
      .send(await s.photo(p, p.photos[run.order[round]]));
  });
  router.get('/leaderboard', async (req, res) => {
    const cursor = decodeCursor(req.query.cursor),
      key = JSON.stringify([req.publication.id, cursor]);
    const cached = boardCache.get(key);
    if (cached?.until > Date.now()) return res.json(cached.value);
    const rows = await s.board(req.publication.id, cursor);
    const value = {
      items: rows.map(({ ownerKey, sortKey, createdAt, ...r }) => r),
      cursor: rows.length === 20 ? encodeCursor(rows.at(-1), 'sortKey') : null,
    };
    if (boardCache.size >= 100) boardCache.delete(boardCache.keys().next().value);
    boardCache.set(key, { value, until: Date.now() + 30_000 });
    res.json(value);
  });
  router.post('/results/share', requireCsrf, async (req, res) => {
    const source = req.body?.source;
    if (source !== 'solo' && !(typeof source === 'string' && /^[\w-]{8,40}$/.test(source)))
      throw new HttpError(400, 'Invalid result source.');
    const token = await s.share(req.publication.id, s.actor(req), source);
    res.json({ url: `/p/${req.publication.id}/results/${token}` });
  });
  router.get('/results/:token', async (req, res) => {
    if (!/^[\w-]{8,40}$/.test(req.params.token)) throw new HttpError(404, 'Result not found.');
    const r = await data.get(s.path(req.publication.id, 'publicSharedResults', req.params.token));
    if (!alive(r)) throw new HttpError(404, 'These results expired.');
    res.json(publicSharedResult(r));
  });
  const viewLive = (g, a) => {
    const v = publicLive(g, a);
    return {
      ...v,
      photoUrl: v.photoUrl?.replace('/api/games/', '/api/publications/') || null,
      credit:
        v.photoUrl && ['results', 'finished'].includes(v.phase)
          ? publicCredits(g.photos[g.live.order[g.live.round]])
          : null,
    };
  };
  router.post('/live', requireCreator, requireCsrf, writeLimit, async (req, res) =>
    res
      .status(201)
      .json(
        viewLive(
          await s.createRoom(req.publication.id, s.actor(req), req.body || {}),
          s.actor(req),
        ),
      ),
  );
  router.use('/live/:liveId', async (req, _res, next) => {
    if (!/^[\w-]{8,40}$/.test(req.params.liveId)) throw new HttpError(404, 'Room not found.');
    req.game = await s.room(req.publication.id, req.params.liveId);
    next();
  });
  router.get(
    '/live/:liveId/events',
    createLiveStreams(s.streamStore, log, {
      watchKey: (req) => `${req.game.id}:${req.params.liveId}`,
      view: viewLive,
    }),
  );
  router.get('/live/:liveId', async (req, res) => {
    let g = req.game;
    if (expireLive(g) !== g)
      g = await s.mutateRoom(g.id, g.live.id, (g, drafts) => expireLive(g, Date.now(), drafts));
    const v = viewLive(g, s.actor(req));
    const d = v.joined ? await s.streamStore.getLiveDraft(g.id, g.live.id, req.playerId) : null;
    if (d?.round === g.live.round && !v.me?.guess)
      v.draft = { point: d.point, version: d.version, round: d.round };
    res.json(v);
  });
  router.post('/live/:liveId/draft', requireCsrf, async (req, res) => {
    const d = await s.saveDraft(req.game.id, req.game.live.id, s.actor(req), req.body || {});
    res.json({ point: d.point, version: d.version, round: d.round, savedAt: d.savedAt });
  });
  router.post('/live/:liveId/:action', requireCsrf, async (req, res) => {
    const g = await s.mutateRoom(
      req.game.id,
      req.game.live.id,
      (g, d) =>
        updateLive(g, g.live.id, s.actor(req), req.params.action, req.body || {}, Date.now(), d),
      s.actor(req),
      req.params.action,
    );
    res.json(viewLive(g, s.actor(req)));
  });
  router.get('/live/:liveId/photos/:round', async (req, res) => {
    const g = req.game,
      l = g.live,
      round = Number(req.params.round);
    if (
      (!l.players[req.playerId]?.active && req.user?.uid !== l.hostUid) ||
      l.phase === 'lobby' ||
      !Number.isInteger(round) ||
      round < 0 ||
      round > l.round
    )
      throw new HttpError(403, 'This photo is not available yet.');
    res
      .type('jpeg')
      .set('Cache-Control', 'private, no-store')
      .send(await s.photo(req.publication, g.photos[l.order[round]]));
  });
  registerCommunityAdmin(app, {
    s,
    requireCreator,
    requireCsrf,
    isAdmin,
    rateLimits,
    clearCache,
  });
  return s;
}
