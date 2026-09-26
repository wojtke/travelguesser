import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import sharp from 'sharp';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createStore } from './store.js';
import { cleanText, coordinates, HttpError, publicGame, publicRun } from './game.js';
import { createLocationSearch } from './location-search.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = v => createHash('sha256').update(v).digest('hex');
const validId = /^[a-zA-Z0-9_-]{8,40}$/;
const demo = {
  id: 'demo-trip', title: 'A little world tour', hostName: 'TravelGuesser', demo: true, createdAt: 0,
  photos: [
    { key: 'demo-paris.jpg', lat: 48.8584, lng: 2.2945, caption: 'The Eiffel Tower, Paris. A classic for a reason.' },
    { key: 'demo-sydney.jpg', lat: -33.8568, lng: 151.2153, caption: 'The Sydney Opera House, right on the harbour.' },
    { key: 'demo-sanfrancisco.jpg', lat: 37.8199, lng: -122.4783, caption: 'The Golden Gate Bridge, San Francisco.' },
  ],
};

export function createApp({ store = createStore(), hostKey = process.env.HOST_KEY || (process.env.NODE_ENV !== 'production' ? 'local-travelguesser-host' : ''), rateLimits = true, searchLocations = createLocationSearch() } = {}) {
  if (!hostKey) throw new Error('HOST_KEY is required in production.');
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:', 'https://tile.openstreetmap.org'],
    fontSrc: ["'self'", 'data:'], connectSrc: ["'self'"],
    upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
  } }, referrerPolicy: { policy: 'strict-origin-when-cross-origin' } }));
  app.use(cookieParser());
  app.use(express.json({ limit: '32kb' }));
  const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 30 * 86400 * 1000, path: '/' };
  app.get('/api/health', (_req,res) => res.json({ status: 'ok' }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      if (req.get('sec-fetch-site') === 'cross-site' || (origin && new URL(origin).host !== req.get('host'))) {
        return next(new HttpError(403, 'Please open the app directly to continue.'));
      }
    }
    let sid = req.cookies.tg_player;
    if (!sid || !/^[a-f0-9]{64}$/.test(sid)) {
      sid = randomBytes(32).toString('hex');
      res.cookie('tg_player', sid, cookieOptions);
    }
    req.playerId = hash(sid);
    req.isHost = typeof req.cookies.tg_host === 'string' && timingSafeEqual(Buffer.from(hash(req.cookies.tg_host)), Buffer.from(hash(hostKey)));
    next();
  });
  if (rateLimits) app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 500, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'A lot of exploring! Please try again in a few minutes.' } }));
  const requireHost = (req, _res, next) => req.isHost ? next() : next(new HttpError(401, 'Use your private host link to create a game.'));
  const loginLimiter = rateLimits ? rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many attempts. Please try again in 15 minutes.' } }) : (_req,_res,next)=>next();
  app.get('/api/session', (req,res) => res.json({ host: req.isHost }));
  app.post('/api/host/session', loginLimiter, (req,res) => {
    if (typeof req.body?.key !== 'string' || !timingSafeEqual(Buffer.from(hash(req.body.key)), Buffer.from(hash(hostKey)))) {
      throw new HttpError(401, 'That host key didn’t match. Check your private host link.');
    }
    res.cookie('tg_host', hostKey, { ...cookieOptions, sameSite: 'strict' });
    res.json({ host: true });
  });
  app.delete('/api/host/session', (_req,res) => { res.clearCookie('tg_host', cookieOptions); res.json({ host: false }); });
  app.get('/api/host/games', requireHost, async (_req,res) => res.json((await store.listGames()).map(publicGame)));
  const searchLimiter = rateLimits ? rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Please wait a minute before searching for more places.' } }) : (_req,_res,next)=>next();
  app.post('/api/host/locations/search', requireHost, searchLimiter, async (req,res) => {
    res.json({ places: await searchLocations(req.body?.query) });
  });
  const upload = multer({ storage: multer.memoryStorage(), limits: { files: 12, fileSize: 2 * 1024 * 1024, fields: 1, fieldSize: 32 * 1024, parts: 13 } });
  app.post('/api/games', requireHost, upload.array('photos', 12), async (req,res) => {
    let meta;
    try { meta = JSON.parse(req.body.metadata); } catch { throw new HttpError(400, 'The game details could not be read.'); }
    const title = cleanText(meta.title, 80, 'Trip title');
    const hostName = cleanText(meta.hostName, 30, 'Your name');
    if (!req.files?.length || req.files.length > 12 || !Array.isArray(meta.photos) || req.files.length !== meta.photos.length) {
      throw new HttpError(400, 'Add between 1 and 12 photos, each with a location.');
    }
    const photos = meta.photos.map((p, i) => ({ ...coordinates(p), caption: typeof p.caption === 'string' ? p.caption.trim().slice(0,200) : '', key: `${i}.jpg` }));
    const id = randomBytes(12).toString('base64url');
    try {
      for (const [i, file] of req.files.entries()) {
        let buffer;
        try { buffer = await sharp(file.buffer, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer(); }
        catch { throw new HttpError(400, `Photo ${i + 1} could not be read. Use JPG, PNG, or WebP.`); }
        await store.savePhoto(id, `${i}.jpg`, buffer);
      }
      const game = await store.saveGame({ id, title, hostName, photos, createdAt: Date.now() });
      res.status(201).json(publicGame(game));
    } catch (e) {
      await store.deleteGame(id).catch(cleanup => console.error('Upload cleanup failed', cleanup.message));
      throw e;
    }
  });
  app.param('gameId', async (req, _res, next, id) => {
    try {
      if (!validId.test(id)) throw new HttpError(404, 'This trip could not be found. Check your invite link.');
      req.game = id === demo.id ? demo : await store.getGame(id);
      if (!req.game) throw new HttpError(404, 'This trip could not be found. It may have been deleted.');
      next();
    } catch(e) { next(e); }
  });
  app.get('/api/games/:gameId', async (req,res) => {
    const run = await store.getRun(req.game.id, req.playerId);
    res.json({ game: publicGame(req.game), run: run ? publicRun(req.game, run) : null });
  });
  app.post('/api/games/:gameId/join', async (req,res) => {
    const name = cleanText(req.body?.name, 24, 'Your name');
    const run = await store.join(req.game.id, req.playerId, name);
    res.json(publicRun(req.game, run));
  });
  app.get('/api/games/:gameId/photos/:round', async (req,res) => {
    const round = Number(req.params.round);
    if (!Number.isInteger(round) || round < 0 || round >= req.game.photos.length) throw new HttpError(404, 'Photo not found.');
    const run = await store.getRun(req.game.id, req.playerId);
    if (!req.isHost && (!run || round > run.results.length)) throw new HttpError(403, 'Join the game and finish the earlier rounds first.');
    const photo = req.game.photos[round];
    const buffer = req.game.demo ? await fs.readFile(path.join(root, 'server', 'demo', photo.key)) : await store.getPhoto(req.game.id, photo.key);
    res.type('jpeg').set('Cache-Control', 'private, max-age=3600').send(buffer);
  });
  app.post('/api/games/:gameId/guess', async (req,res) => {
    const { run, result } = await store.guess(req.game, req.playerId, req.body || {});
    res.json({ result, run: publicRun(req.game, run) });
  });
  app.get('/api/games/:gameId/leaderboard', async (req,res) => res.json(await store.leaderboard(req.game.id)));
  app.delete('/api/games/:gameId', requireHost, async (req,res) => {
    if (req.game.demo) throw new HttpError(400, 'The demo cannot be deleted.');
    await store.deleteGame(req.game.id);
    res.json({ deleted: true });
  });
  app.use('/api', (_req,_res,next) => next(new HttpError(404, 'Endpoint not found.')));
  app.use(express.static(path.join(root, 'dist'), { maxAge: '1h', index: false }));
  app.get('/{*path}', (_req,res) => res.sendFile(path.join(root, 'dist', 'index.html')));
  app.use((err,_req,res,_next) => {
    if (err instanceof multer.MulterError) return res.status(400).json({ error: 'Use up to 12 photos, each smaller than 2 MB after resizing.' });
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong. Please try again in a moment.' : err.message });
  });
  return app;
}
