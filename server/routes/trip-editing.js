import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { cleanText, coordinates, gameSettings, HttpError, publicGame } from '../game.js';
import { LIMITS } from '../limits.js';
import {
  checkEditVersion,
  commitTripEdit,
  discardTripEdit,
  recoverTripEdit,
  reserveTripEdit,
  TRIP_STORAGE_BYTES,
} from '../trip-editing.js';
import { errorDetails } from '../observability.js';

export function registerTripEditingRoutes(
  app,
  { store, requireCreator, requireCsrf, uploadLimiter, admitUpload, upload, log },
) {
  const owner = (req, _res, next) => {
    if (req.game.demo || req.game.ownerUid !== req.user.uid)
      throw new HttpError(403, 'Only the trip creator can edit this trip.');
    next();
  };
  app.get('/api/games/:gameId/edit', requireCreator, owner, async (req, res) => {
    const g = await recoverTripEdit(store, req.game, req.user.uid);
    res.json({
      ...publicGame(g),
      hasPublicEdition: !!g.publicationId,
      storageBytes: g.storageBytes || 0,
      storageLimit: TRIP_STORAGE_BYTES,
      photos: g.photos.map((p, i) => ({
        key: p.key,
        lat: p.lat,
        lng: p.lng,
        caption: p.caption || '',
        url: `/api/games/${g.id}/edit/photos/${i}?revision=${g.tripRevision || 0}`,
      })),
    });
  });
  app.get('/api/games/:gameId/edit/photos/:photo', requireCreator, owner, async (req, res) => {
    checkEditVersion(req.game, Number(req.query.revision));
    const i = Number(req.params.photo);
    if (!Number.isInteger(i) || i < 0 || i >= req.game.photos.length)
      throw new HttpError(404, 'Photo not found.');
    if (req.query.thumbnail !== undefined && req.query.thumbnail !== '1')
      throw new HttpError(400, 'Unknown preview size.');
    let photo = await store.getPhoto(req.game.id, req.game.photos[i].key);
    if (req.query.thumbnail === '1')
      photo = await sharp(photo, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize({ width: 240, height: 160, fit: 'cover', withoutEnlargement: true })
        .jpeg({ quality: 70 })
        .toBuffer();
    res.type('jpeg').set('Cache-Control', 'private, no-store').send(photo);
  });
  app.patch(
    '/api/games/:gameId',
    requireCreator,
    requireCsrf,
    owner,
    uploadLimiter,
    admitUpload,
    upload.array('photos', 12),
    async (req, res) => {
      req.processingPhotos = true;
      let reservation,
        committed = false;
      try {
        let meta;
        try {
          meta = JSON.parse(req.body.metadata);
        } catch {
          throw new HttpError(400, 'The trip details could not be read.');
        }
        if (!meta || typeof meta !== 'object' || Array.isArray(meta))
          throw new HttpError(400, 'The trip details could not be read.');
        const game = await recoverTripEdit(store, req.game, req.user.uid);
        checkEditVersion(game, meta.tripRevision);
        const changes = {
          title: cleanText(meta.title, 80, 'Trip title'),
          hostName: cleanText(meta.hostName, 30, 'Your name'),
          settings: gameSettings(meta.settings),
        };
        if (
          !Array.isArray(meta.photos) ||
          !meta.photos.length ||
          meta.photos.length > LIMITS.photosPerTrip
        )
          throw new HttpError(400, 'Keep between 1 and 12 photos, each with a location.');
        const files = req.files || [],
          used = new Set(),
          token = randomBytes(16).toString('base64url');
        changes.photos = meta.photos.map((p) => {
          const point = coordinates(p);
          let key;
          if (
            typeof p.key === 'string' &&
            game.photos.some((old) => old.key === p.key) &&
            p.uploadIndex === undefined
          )
            key = p.key;
          else if (
            p.key === undefined &&
            Number.isInteger(p.uploadIndex) &&
            p.uploadIndex >= 0 &&
            p.uploadIndex < files.length
          )
            key = `edit-${token}-${p.uploadIndex}.jpg`;
          else
            throw new HttpError(
              400,
              'A photo is missing or no longer belongs to this trip. Reload the editor.',
            );
          if (used.has(key)) throw new HttpError(400, 'Each photo may appear only once.');
          used.add(key);
          return {
            ...point,
            key,
            caption: typeof p.caption === 'string' ? p.caption.trim().slice(0, 200) : '',
          };
        });
        if (files.some((_, i) => !used.has(`edit-${token}-${i}.jpg`)))
          throw new HttpError(400, 'Unexpected photo upload.');
        const buffers = [];
        for (const [i, file] of files.entries()) {
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
          buffers.push(buffer);
        }
        const uploadData = {
          token,
          bytes: buffers.reduce((total, b) => total + b.length, 0),
          keys: buffers.map((_, i) => `edit-${token}-${i}.jpg`),
          createdAt: Date.now(),
        };
        await reserveTripEdit(store, game.id, req.user.uid, meta.tripRevision, uploadData);
        reservation = uploadData;
        for (const [i, buffer] of buffers.entries())
          await store.savePhoto(game.id, uploadData.keys[i], buffer);
        const saved = await commitTripEdit(
          store,
          game.id,
          req.user.uid,
          meta.tripRevision,
          token,
          changes,
        );
        committed = true;
        res.json(publicGame(saved));
      } catch (error) {
        if (reservation && !committed)
          await discardTripEdit(store, req.game.id, req.user.uid, reservation).catch((cleanup) =>
            log({ event: 'edit_cleanup_failed', severity: 'ERROR', ...errorDetails(cleanup) }),
          );
        throw error;
      } finally {
        req.releaseUpload();
      }
    },
  );
}
