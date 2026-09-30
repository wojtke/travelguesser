import rateLimit from 'express-rate-limit';
import { privateNetworkKey } from '../request-limits.js';
import { prepareDailies, repairFutureDailies } from '../public-schedule.js';
import { timingSafeEqual } from 'node:crypto';
import { HttpError, cleanText, coordinates } from '../game.js';
import {
  DAY,
  publicId,
  identityKey,
  alive,
  decodeCursor,
  encodeCursor,
} from '../public-content.js';

export function registerCommunityAdmin(
  app,
  { s, requireCreator, requireCsrf, isAdmin, rateLimits, clearCache },
) {
  const { data } = s;
  const admin = (req, _res, next) =>
    isAdmin(req) ? next() : next(new HttpError(403, 'Operator access is required.'));
  const reportLimiter = rateLimits
    ? rateLimit({
        keyGenerator: privateNetworkKey,
        windowMs: 3600_000,
        limit: 10,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
      })
    : (_req, _res, next) => next();
  const viewReport = (r) => ({
    id: r.id,
    category: r.category,
    target: r.target,
    status: r.status,
    createdAt: r.createdAt,
    messages: r.messages.map(({ by, text, at }) => ({ by, text, at })),
  });
  const canRead = (req, r) =>
    isAdmin(req) ||
    (!!r?.tokenHash &&
      typeof req.get('X-Report-Token') === 'string' &&
      timingSafeEqual(
        Buffer.from(r.tokenHash),
        Buffer.from(identityKey(req.get('X-Report-Token'))),
      ));
  app.post('/api/reports', requireCsrf, reportLimiter, async (req, res) => {
    const b = req.body || {},
      category = b.category;
    if (!['copyright', 'privacy', 'illegal', 'nickname', 'service', 'appeal'].includes(category))
      throw new HttpError(400, 'Choose a report category.');
    const target = typeof b.target === 'string' ? b.target.trim().slice(0, 250) : '';
    if (target && !/^\/(?:g|p|contact)\/[\w/-]+$/.test(target))
      throw new HttpError(400, 'Use the trip path, such as /p/trip-code.');
    const message = cleanText(b.message, 4000, 'Message');
    const email = typeof b.email === 'string' ? b.email.trim() : '';
    if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))
      throw new HttpError(400, 'Enter a valid contact email or leave it blank.');
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 100) : '';
    if (b.goodFaith !== true)
      throw new HttpError(
        400,
        'Confirm that this report is accurate to the best of your knowledge.',
      );
    const id = publicId(),
      token = publicId() + publicId(),
      now = Date.now();
    await data.transaction(async (t) =>
      t.set(`publicReports/${id}`, {
        id,
        category,
        target,
        name,
        email,
        status: 'open',
        createdAt: now,
        updatedAt: now,
        tokenHash: identityKey(token),
        goodFaith: true,
        messages: [{ by: 'You', text: message, at: now }],
      }),
    );
    s.log({ event: 'report_received', severity: 'WARNING' });
    res.status(201).json({ id, token, url: `/contact/${id}#${token}` });
  });
  app.get('/api/reports/:reportId', async (req, res) => {
    if (!/^[\w-]{8,40}$/.test(req.params.reportId)) throw new HttpError(404, 'Report not found.');
    const r = await data.get(`publicReports/${req.params.reportId}`);
    if (!alive(r) || !canRead(req, r))
      throw new HttpError(404, 'Report not found. Open your private receipt link.');
    res.json(viewReport(r));
  });
  app.post('/api/reports/:reportId/replies', requireCsrf, reportLimiter, async (req, res) => {
    if (!/^[\w-]{8,40}$/.test(req.params.reportId)) throw new HttpError(404, 'Report not found.');
    const message = cleanText(req.body?.message, 4000, 'Reply');
    const r = await data.transaction(async (t) => {
      const key = `publicReports/${req.params.reportId}`,
        old = await t.get(key);
      if (!alive(old) || !canRead(req, old)) throw new HttpError(404, 'Report not found.');
      if (old.messages.length >= 50)
        throw new HttpError(
          409,
          'This thread is full. Open a new report referencing this receipt.',
        );
      const next = {
        ...old,
        status: isAdmin(req) && req.body.close ? 'closed' : 'open',
        updatedAt: Date.now(),
        messages: [
          ...old.messages,
          { by: isAdmin(req) ? 'TripGuessr operator' : 'You', text: message, at: Date.now() },
        ],
      };
      if (next.status === 'closed') next.expiresAt = new Date(Date.now() + 180 * DAY);
      else delete next.expiresAt;
      t.set(key, next);
      return next;
    });
    if (!isAdmin(req)) s.log({ event: 'report_received', severity: 'WARNING' });
    res.json(viewReport(r));
  });
  app.use('/api/admin', requireCreator, admin);
  app.param('id', (_req, _res, next, id) =>
    /^[\w-]{8,80}$/.test(id) ? next() : next(new HttpError(404, 'Not found.')),
  );
  app.get('/api/admin/:collection', async (req, res) => {
    const collections = {
      reports: 'publicReports',
      assets: 'officialAssets',
      publications: 'publications',
      profiles: 'publicProfiles',
    };
    const collection = collections[req.params.collection];
    if (!collection) throw new HttpError(404, 'Not found.');
    const rows = await data.list(collection, { cursor: decodeCursor(req.query.cursor), limit: 25 });
    res.json({
      items: rows.map(({ tokenHash, ...r }) => r),
      cursor: rows.length === 25 ? encodeCursor(rows.at(-1), 'createdAt') : null,
    });
  });
  app.post('/api/admin/profiles/:id/restriction', requireCsrf, async (req, res) => {
    if (!/^[a-f0-9]{64}$/.test(req.params.id) || typeof req.body?.suspended !== 'boolean')
      throw new HttpError(400, 'Choose an account and restriction.');
    const reason = cleanText(req.body.reason, 1000, 'Reason');
    await data.transaction(async (t) => {
      const key = `publicProfiles/${req.params.id}`,
        p = await t.get(key);
      if (!p) throw new HttpError(404, 'Public profile not found.');
      t.set(key, { ...p, suspended: req.body.suspended, moderationReason: reason });
    });
    res.json({ updated: true });
  });
  app.get('/api/admin/publications/:id', async (req, res) => {
    const p = await data.get(`publications/${req.params.id}`);
    if (!p) throw new HttpError(404, 'Public edition not found.');
    res.json(p);
  });
  app.post('/api/admin/publications/:id/moderate', requireCsrf, async (req, res) => {
    if (!['remove', 'restore'].includes(req.body?.action))
      throw new HttpError(400, 'Choose remove or restore.');
    const reason = cleanText(req.body?.reason, 1000, 'Reason');
    const p = await data.transaction(async (t) => {
      const key = `publications/${req.params.id}`,
        old = await t.get(key);
      if (!old) throw new HttpError(404, 'Trip not found.');
      const next = {
        ...old,
        blocked: req.body.action !== 'restore',
        state: req.body.action === 'restore' ? 'published' : 'removed',
        moderationReason: reason,
        moderatedAt: Date.now(),
        roomEpoch: (old.roomEpoch || 0) + (req.body.action === 'restore' ? 0 : 1),
      };
      if (req.body.suspendPublisher && old.ownerUid) {
        const profileKey = s.profilePath(old.ownerUid),
          profile = await t.get(profileKey);
        t.set(profileKey, {
          ...profile,
          id: identityKey(old.ownerUid),
          suspended: req.body.action !== 'restore',
          moderationReason: reason,
        });
      }
      t.set(key, next);
      return next;
    });
    clearCache();
    res.json({ id: p.id, state: p.state });
  });
  app.get('/api/admin/publications/:id/scores', async (req, res) => {
    const rows = await data.list(`publications/${req.params.id}/publicScores`, {
      order: 'sortKey',
      direction: 'asc',
      cursor: decodeCursor(req.query.cursor),
      limit: 20,
    });
    res.json({
      items: rows.map(({ ownerKey, ...r }) => r),
      cursor: rows.length === 20 ? encodeCursor(rows.at(-1), 'sortKey') : null,
    });
  });
  app.post(
    '/api/admin/publications/:id/scores/:scoreId/moderate',
    requireCsrf,
    async (req, res) => {
      if (!/^[\w-]{8,40}$/.test(req.params.scoreId)) throw new HttpError(404, 'Score not found.');
      const reason = cleanText(req.body?.reason, 1000, 'Reason');
      await data.transaction(async (t) => {
        const key = `publications/${req.params.id}/publicScores/${req.params.scoreId}`,
          score = await t.get(key);
        if (!score) throw new HttpError(404, 'Score not found.');
        const claimKey = s.path(req.params.id, 'rankClaims', score.ownerKey),
          claim = await t.get(claimKey);
        const profileKey = `publicProfiles/${score.ownerKey.slice(2)}`,
          profile = await t.get(profileKey);
        t.set(claimKey, { ...claim, withdrawn: true });
        t.set(profileKey, {
          ...profile,
          moderationReason: reason,
          ...(req.body.suspendPlayer === true ? { suspended: true } : {}),
        });
        t.delete(`${profileKey}/scores/${req.params.id}`);
        t.delete(key);
      });
      clearCache();
      res.json({ removed: true });
    },
  );
  app.get('/api/admin/assets/:id/photo', async (req, res) => {
    const asset = await data.get(`officialAssets/${req.params.id}`);
    if (!asset) throw new HttpError(404, 'Photo not found.');
    res
      .type('jpeg')
      .set('Cache-Control', 'private, no-store')
      .send(
        await s.photo(
          { id: 'official-library' },
          { key: asset.key, storageGameId: 'official-library' },
        ),
      );
  });
  app.post('/api/admin/assets/:id/review', requireCsrf, async (req, res) => {
    if (!['approve', 'reject'].includes(req.body?.action))
      throw new HttpError(400, 'Choose approve or reject.');
    const a = await data.transaction(async (t) => {
      const key = `officialAssets/${req.params.id}`,
        old = await t.get(key);
      if (!old) throw new HttpError(404, 'Photo not found.');
      const approved = req.body.action === 'approve';
      if (
        approved &&
        (old.credit?.license !== 'CC0-1.0' ||
          req.body.rightsReviewed !== true ||
          req.body.locationReviewed !== true)
      )
        throw new HttpError(
          400,
          'Verify the CC0 licence, image rights, and camera location before approval.',
        );
      const control = (await t.get('publicControl/assets')) || { disabled: [] };
      const disabled = new Set(control.disabled);
      approved ? disabled.delete(old.id) : disabled.add(old.id);
      t.set('publicControl/assets', { disabled: [...disabled] });
      const next = {
        ...old,
        status: approved ? 'approved' : 'rejected',
        reviewedAt: Date.now(),
        reviewedBy: identityKey(req.user.uid),
        ...(req.body.location ? coordinates(req.body.location) : {}),
      };
      t.set(key, next);
      return next;
    });
    clearCache();
    res.json(a);
  });
  app.post('/api/admin/repair-schedule', requireCsrf, async (_req, res) => {
    const result = await repairFutureDailies(data);
    clearCache();
    res.json(result);
  });
  app.post('/api/admin/schedule', requireCsrf, async (req, res) => {
    const startDate = req.body?.startDate;
    if (
      typeof startDate !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
      startDate < new Date().toISOString().slice(0, 10)
    )
      throw new HttpError(400, 'Schedule today or a future date.');
    const result = await prepareDailies(data, startDate, req.body.days ?? 365);
    clearCache();
    res.json(result);
  });
}
