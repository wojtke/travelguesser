import { defaultTripTitle, publicSharedResult } from './results.js';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createRequestLimits, privateNetworkKey } from './request-limits.js';
import multer from 'multer';
import sharp from 'sharp';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { registerLiveRoutes } from './routes/live.js';
import { registerSoloRoutes } from './routes/solo.js';
import { registerPublicRoutes } from './routes/public.js';
import { createStore } from './store.js';
import { cleanText, coordinates, gameSettings, HttpError, publicGame } from './game.js';
import { newLive } from './live.js';
import { createLocationSearch } from './location-search.js';
import { createAuthentication, SESSION_DURATION } from './auth.js';
import { LIMITS } from './limits.js';
import { errorDetails, isAppPage, observeRequests, writeLog } from './observability.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = (v) => createHash('sha256').update(v).digest('hex');
const safeOrigin = (origin, host) => {
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
};
const validId = /^[a-zA-Z0-9_-]{8,40}$/;
const demo = {
  id: 'demo-trip',
  title: 'World landmarks',
  hostName: 'TripGuessr',
  demo: true,
  createdAt: 0,
  photos: [
    { key: 'demo-paris.jpg', lat: 48.8584, lng: 2.2945, caption: 'The Eiffel Tower, Paris.' },
    {
      key: 'demo-sydney.jpg',
      lat: -33.8568,
      lng: 151.2153,
      caption: 'The Sydney Opera House, right on the harbour.',
    },
    {
      key: 'demo-sanfrancisco.jpg',
      lat: 37.8199,
      lng: -122.4783,
      caption: 'The Golden Gate Bridge, San Francisco.',
    },
  ],
};

export function createApp({
  store = createStore(),
  auth = createAuthentication(),
  rateLimits = true,
  rateLimitOptions = {},
  searchLocations = createLocationSearch(),
  log = process.env.NODE_ENV === 'production' ? writeLog : () => {},
  distDirectory = path.join(root, 'dist'),
  publicEnabled = process.env.PUBLIC_TRIPS_ENABLED === 'true' ||
    process.env.NODE_ENV !== 'production',
  adminUids = (
    process.env.ADMIN_UIDS || (process.env.NODE_ENV !== 'production' ? 'local-developer' : '')
  )
    .split(',')
    .filter(Boolean),
} = {}) {
  const authOrigin = auth.config.firebase ? `https://${auth.config.firebase.authDomain}` : null;
  const app = express();
  app.disable('x-powered-by');
  app.use(observeRequests(log));
  app.use((req, res, next) => {
    if (/^\/(g|p|explore|daily|contact|admin|api|create)(?:\/|$)/.test(req.path))
      res
        .set('X-Robots-Tag', 'noindex, nofollow, noarchive, noimageindex, nosnippet')
        .set('Cache-Control', 'no-store');
    next();
  });
  app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", 'https://apis.google.com'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:', 'https://tile.openstreetmap.org'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: [
            "'self'",
            'https://identitytoolkit.googleapis.com',
            'https://securetoken.googleapis.com',
            'https://www.googleapis.com',
            ...(authOrigin ? [authOrigin] : []),
          ],
          frameSrc: ['https://accounts.google.com', ...(authOrigin ? [authOrigin] : [])],
          upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
        },
      },
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
      referrerPolicy: { policy: 'strict-origin' },
    }),
  );
  const requestLimits = rateLimits ? createRequestLimits(rateLimitOptions) : null;
  if (requestLimits)
    app.use('/api', (req, res, next) =>
      req.path === '/health' && ['GET', 'HEAD'].includes(req.method)
        ? next()
        : requestLimits.early[0](req, res, (err) =>
            err ? next(err) : requestLimits.early[1](req, res, next),
          ),
    );
  app.use(cookieParser());
  app.use(express.json({ limit: '32kb' }));
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 86400 * 1000,
    path: '/',
  };
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api', async (req, res, next) => {
    // A pair of timestamps lets clients exclude authentication/database work
    // from clock synchronization rather than mistaking it for network latency.
    res.set('X-TripGuessr-Received-At', String(Date.now()));
    const sendJson = res.json;
    res.json = function (body) {
      this.set('X-TripGuessr-Sent-At', String(Date.now()));
      return sendJson.call(this, body);
    };
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      if (
        req.get('sec-fetch-site') === 'cross-site' ||
        (origin && !safeOrigin(origin, req.get('host')))
      ) {
        return next(new HttpError(403, 'Please open the app directly to continue.'));
      }
    }
    let sid = req.cookies.tg_player;
    if (!sid || !/^[a-f0-9]{64}$/.test(sid)) {
      sid = randomBytes(32).toString('hex');
      res.cookie('tg_player', sid, cookieOptions);
    }
    req.playerId = hash(sid);
    let csrf = req.cookies.tg_csrf;
    if (!csrf || !/^[a-f0-9]{64}$/.test(csrf)) {
      csrf = randomBytes(32).toString('hex');
      res.cookie('tg_csrf', csrf, cookieOptions);
    }
    req.csrfToken = csrf;
    req.user = null;
    if (typeof req.cookies.tg_creator === 'string') {
      try {
        req.user = await auth.verifySession(req.cookies.tg_creator);
      } catch {
        res.clearCookie('tg_creator', cookieOptions);
      }
    }
    next();
  });
  if (requestLimits) app.use('/api', requestLimits.gameplay);
  const requireCreator = (req, _res, next) =>
    req.user
      ? next()
      : next(new HttpError(401, 'Sign in with Google to create and manage your trips.'));
  const requireCsrf = (req, _res, next) =>
    typeof req.get('x-csrf-token') === 'string' &&
    timingSafeEqual(Buffer.from(hash(req.get('x-csrf-token'))), Buffer.from(hash(req.csrfToken)))
      ? next()
      : next(new HttpError(403, 'Please refresh the page and try again.'));
  const loginLimiter = rateLimits
    ? rateLimit({
        keyGenerator: privateNetworkKey,
        windowMs: 15 * 60 * 1000,
        limit: 30,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: { error: 'Too many sign-in attempts. Please try again in 15 minutes.' },
      })
    : (_req, _res, next) => next();
  app.get('/api/session', (req, res) =>
    res.json({ user: req.user, auth: auth.config, csrfToken: req.csrfToken, limits: LIMITS }),
  );
  app.post('/api/auth/session', loginLimiter, requireCsrf, async (req, res) => {
    const { cookie, user } = await auth.createSession(req.body?.idToken);
    res.cookie('tg_creator', cookie, { ...cookieOptions, maxAge: SESSION_DURATION });
    res.clearCookie('tg_host', cookieOptions);
    res.json({ user });
  });
  app.delete('/api/auth/session', requireCsrf, (_req, res) => {
    res.clearCookie('tg_creator', cookieOptions);
    res.clearCookie('tg_host', cookieOptions);
    res.json({ user: null });
  });
  app.get('/api/host/games', requireCreator, async (req, res) =>
    res.json((await store.listGames(req.user.uid)).map(publicGame)),
  );
  app.get('/api/host/usage', requireCreator, async (req, res) =>
    res.json(await store.getUsage(req.user.uid)),
  );
  const searchLimiter = rateLimits
    ? rateLimit({
        keyGenerator: privateNetworkKey,
        windowMs: 60_000,
        limit: 20,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: { error: 'Please wait a minute before searching for more places.' },
      })
    : (_req, _res, next) => next();
  app.post(
    '/api/host/locations/search',
    requireCreator,
    requireCsrf,
    searchLimiter,
    async (req, res) => {
      res.json({ places: await searchLocations(req.body?.query) });
    },
  );
  let processingUpload = false;
  const admitUpload = (req, res, next) => {
    if (processingUpload)
      return res
        .status(429)
        .set('Retry-After', '2')
        .json({ error: 'Another upload is processing. Please retry in a moment.' });
    processingUpload = true;
    let done = false;
    const release = () => {
      if (!done) {
        done = true;
        processingUpload = false;
      }
    };
    req.releaseUpload = release;
    const releaseIdle = () => {
      if (!req.processingPhotos) release();
    };
    res.once('finish', releaseIdle);
    res.once('close', releaseIdle);
    next();
  };
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 12, fileSize: 2 * 1024 * 1024, fields: 1, fieldSize: 32 * 1024, parts: 13 },
  });
  const uploadLimiter = rateLimits
    ? rateLimit({
        keyGenerator: privateNetworkKey,
        windowMs: 60_000,
        limit: 10,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: { error: 'Please wait a minute before uploading another trip.' },
      })
    : (_req, _res, next) => next();
  app.post(
    '/api/games',
    requireCreator,
    requireCsrf,
    uploadLimiter,
    admitUpload,
    upload.array('photos', 12),
    async (req, res) => {
      req.processingPhotos = true;
      try {
        let meta;
        try {
          meta = JSON.parse(req.body.metadata);
        } catch {
          throw new HttpError(400, 'The game details could not be read.');
        }
        if (!meta || typeof meta !== 'object' || Array.isArray(meta))
          throw new HttpError(400, 'The game details could not be read.');
        const autoTitle = meta.autoTitle === true;
        const title = autoTitle
          ? defaultTripTitle(req.user.name, 1)
          : cleanText(meta.title, 80, 'Trip title');
        const hostName = cleanText(meta.hostName, 30, 'Your name');
        const settings = gameSettings(meta.settings);
        if (
          !req.files?.length ||
          req.files.length > 12 ||
          !Array.isArray(meta.photos) ||
          req.files.length !== meta.photos.length
        ) {
          throw new HttpError(400, 'Add between 1 and 12 photos, each with a location.');
        }
        const photos = meta.photos.map((p, i) => ({
          ...coordinates(p),
          caption: typeof p.caption === 'string' ? p.caption.trim().slice(0, 200) : '',
          key: `${i}.jpg`,
        }));
        const id = randomBytes(16).toString('base64url');
        const ownerUid = req.user.uid;
        await store.beginGame({
          id,
          title,
          hostName,
          photos,
          ownerUid,
          ...(autoTitle ? { autoTitle: true, titleFirstName: req.user.name || '' } : {}),
          settings,
          sharing: true,
          createdAt: Date.now(),
        });
        let storageBytes = 0;
        try {
          for (const [i, file] of req.files.entries()) {
            let buffer;
            try {
              buffer = await sharp(file.buffer, { limitInputPixels: 40_000_000 })
                .rotate()
                .resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 85 })
                .toBuffer();
            } catch {
              throw new HttpError(400, `Photo ${i + 1} could not be read. Use JPG, PNG, or WebP.`);
            }
            if (buffer.length > LIMITS.photoBytes)
              throw new HttpError(
                400,
                `Photo ${i + 1} is too detailed. Please choose a smaller image.`,
              );
            storageBytes += buffer.length;
            await store.savePhoto(id, `${i}.jpg`, buffer);
          }
          let game = await store.publishGame(id, ownerUid, storageBytes);
          if (settings.mode === 'live') game = await store.mutateGame(id, (g) => newLive(g));
          res.status(201).json(publicGame(game));
        } catch (e) {
          await store
            .deleteGame(id, ownerUid)
            .catch((cleanup) =>
              log({ event: 'upload_cleanup_failed', severity: 'ERROR', ...errorDetails(cleanup) }),
            );
          throw e;
        }
      } finally {
        req.releaseUpload();
      }
    },
  );
  app.param('gameId', async (req, _res, next, id) => {
    try {
      if (!validId.test(id))
        throw new HttpError(404, 'This trip could not be found. Check your invite link.');
      req.game = id === demo.id ? demo : await store.getGame(id);
      if (!req.game)
        throw new HttpError(404, 'This trip could not be found. It may have been deleted.');
      if (req.game.sharing === false && req.user?.uid !== req.game.ownerUid)
        throw new HttpError(403, 'The creator has paused sharing for this trip.');
      next();
    } catch (e) {
      next(e);
    }
  });
  registerSoloRoutes(app, { store, requireCsrf, root });
  app.patch('/api/games/:gameId/sharing', requireCreator, requireCsrf, async (req, res) => {
    if (typeof req.body?.enabled !== 'boolean')
      throw new HttpError(400, 'Choose whether sharing is enabled.');
    const game = await store.mutateGame(req.game.id, (g) => {
      if (g.ownerUid !== req.user.uid)
        throw new HttpError(403, 'This trip belongs to another creator.');
      return {
        ...g,
        sharing: req.body.enabled,
        sharingVersion: (g.sharingVersion || 0) + (req.body.enabled ? 0 : 1),
        ...(!req.body.enabled && g.live ? { live: { ...g.live, phase: 'finished' } } : {}),
      };
    });
    res.json(publicGame(game));
  });
  registerLiveRoutes(app, { store, requireCreator, requireCsrf, log });
  registerPublicRoutes(app, {
    store,
    requireCreator,
    requireCsrf,
    log,
    rateLimits,
    publicEnabled,
    adminUids,
  });
  app.post('/api/games/:gameId/results/share', requireCsrf, async (req, res) => {
    const source = req.body?.source;
    if (typeof source !== 'string' || !(/^[a-zA-Z0-9_-]{8,40}$/.test(source) || source === 'solo'))
      throw new HttpError(400, 'Invalid result source.');
    const { token } = await store.createSharedResult(
      req.game.id,
      { uid: req.user?.uid, playerId: req.playerId },
      source,
    );
    res.json({ url: `/g/${req.game.id}/results/${token}` });
  });
  app.get('/api/games/:gameId/results/:token', async (req, res) => {
    if (req.game.sharing === false) throw new HttpError(403, 'Sharing is paused for this trip.');
    if (!validId.test(req.params.token)) throw new HttpError(404, 'Result not found.');
    const record = await store.getSharedResult(req.game.id, req.params.token);
    if (!record) throw new HttpError(404, 'This shared result has expired or is unavailable.');
    res.json(publicSharedResult(record));
  });
  app.delete('/api/games/:gameId', requireCreator, requireCsrf, async (req, res) => {
    if (req.game.demo) throw new HttpError(400, 'The demo cannot be deleted.');
    if (req.game.ownerUid !== req.user.uid)
      throw new HttpError(403, 'This trip belongs to another creator.');
    await store.deleteGame(req.game.id, req.user.uid);
    res.json({ deleted: true });
  });
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Endpoint not found.')));
  app.get('/robots.txt', (_req, res) =>
    res
      .type('text/plain')
      .send(
        'User-agent: *\nAllow: /\n# Trip and API responses carry X-Robots-Tag: noindex. They must remain crawlable for it to work.\n',
      ),
  );
  app.use(express.static(distDirectory, { maxAge: '1h', index: false }));
  app.get('/{*path}', (req, res) =>
    res.status(isAppPage(req.path) ? 200 : 404).sendFile(path.join(distDirectory, 'index.html')),
  );
  app.use((err, _req, res, _next) => {
    if (err instanceof multer.MulterError)
      return res
        .status(400)
        .json({ error: 'Use up to 12 photos, each smaller than 2 MB after resizing.' });
    const status = err.status || 500;
    if (status >= 500) res.locals.telemetryError = errorDetails(err);
    res.status(status).json({
      error:
        status >= 500
          ? 'Something went wrong. Please try again in a moment.'
          : err instanceof HttpError
            ? err.message
            : status === 404
              ? 'Not found.'
              : 'The request could not be read.',
    });
  });
  return app;
}
