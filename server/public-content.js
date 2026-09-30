import { createHash, randomBytes } from 'node:crypto';
import { HttpError, cleanText, gameSettings } from './game.js';

export const DAY = 86400_000;
export const publicId = () => randomBytes(16).toString('base64url');
export const identityKey = (uid) => createHash('sha256').update(uid).digest('hex');
export const millis = (v) => v?.toMillis?.() ?? (typeof v === 'number' ? v : new Date(v).getTime());
export const alive = (v, now = Date.now()) => v && (!v.expiresAt || millis(v.expiresAt) > now);
export const normalize = (s) =>
  String(s || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
export function searchPrefixes(title, tags = []) {
  const out = new Set();
  for (const text of [title, ...tags]) {
    const words = normalize(text).split(' ').slice(0, 16);
    for (let i = 0; i < words.length; i++) {
      const tail = words.slice(i).join(' ').slice(0, 40);
      for (let n = 2; n <= tail.length; n++) out.add(tail.slice(0, n).trim());
    }
  }
  return [...out].slice(0, 800);
}
export function publicationInput(input) {
  if (input.rightsConfirmed !== true || input.visibilityConfirmed !== true)
    throw new HttpError(
      400,
      'Confirm your photo rights and that the photos and locations may be shown publicly.',
    );
  const title = cleanText(input.title, 80, 'Public title');
  const hostName = cleanText(input.nickname, 24, 'Public creator nickname');
  const tags = [
    ...new Set((Array.isArray(input.tags) ? input.tags : []).map((v) => cleanText(v, 24, 'Tag'))),
  ];
  if (tags.length > 5) throw new HttpError(400, 'Use at most five tags.');
  const timeLimitSeconds = input.timeLimitSeconds ?? 60;
  return {
    title,
    hostName,
    tags,
    searchPrefixes: searchPrefixes(title, tags),
    settings: gameSettings({ mode: 'solo', timeLimitSeconds, shufflePhotos: false }),
  };
}
export function checkPublication(p, now = Date.now()) {
  if (!p || p.state !== 'published' || p.publishedAt > now || p.blocked)
    throw new HttpError(404, 'This public trip is unavailable.');
  return p;
}
export function publicEdition(p) {
  return {
    id: p.id,
    title: p.title,
    hostName: p.hostName,
    tags: p.tags || [],
    kind: p.kind,
    dailyDate: p.dailyDate || null,
    rounds: p.photos.length,
    createdAt: p.publishedAt,
    settings: p.settings,
    sharing: true,
    liveId: null,
    demo: false,
    publicEdition: true,
  };
}
export function publicCredits(photo) {
  if (!photo?.credit) return null;
  const { author, title, source, license, licenseUrl } = photo.credit;
  return {
    author,
    title,
    source,
    license,
    licenseUrl,
    changes: 'Resized and re-encoded; metadata removed.',
  };
}
export function decodeCursor(value) {
  if (!value) return null;
  try {
    if (typeof value !== 'string' || value.length > 500) throw new Error();
    const c = JSON.parse(Buffer.from(value, 'base64url'));
    if (
      !/^[\w-]{8,80}$/.test(c.id) ||
      !(Number.isFinite(c.value) || (typeof c.value === 'string' && c.value.length <= 100))
    )
      throw new Error();
    return { id: c.id, value: c.value };
  } catch {
    throw new HttpError(400, 'Invalid page cursor.');
  }
}
export const encodeCursor = (row, field) =>
  row ? Buffer.from(JSON.stringify({ id: row.id, value: row[field] })).toString('base64url') : null;
export const scoreOrder = (r) =>
  `${String(60001 - r.score).padStart(5, '0')}:${String(Math.round(r.durationMs || 0)).padStart(12, '0')}:${String(r.finishedAt).padStart(15, '0')}`;

// Deterministic and bounded. A reviewed pool is scheduled once, outside gameplay.
export function scheduleDailies(assets, startDate, days = 365, history = []) {
  if (assets.length < 150 || assets.some((a) => a.status !== 'approved'))
    throw new HttpError(400, 'Approve at least 150 photos before scheduling daily challenges.');
  const start = Date.parse(`${startDate}T00:00:00Z`);
  if (
    !Number.isFinite(start) ||
    new Date(start).toISOString().slice(0, 10) !== startDate ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > 366
  )
    throw new HttpError(400, 'Choose a valid date and up to 366 days.');
  const lastUsed = new Map(),
    result = [];
  const existing = new Map(history.map((r) => [r.date, r.assets]));
  for (const r of history) {
    const offset = Math.round((Date.parse(`${r.date}T00:00:00Z`) - start) / DAY);
    if (offset < 0)
      for (const id of r.assets) lastUsed.set(id, Math.max(lastUsed.get(id) ?? -Infinity, offset));
  }
  for (let day = 0; day < days; day++) {
    const date = new Date(start + day * DAY).toISOString().slice(0, 10);
    if (existing.has(date)) {
      const ids = existing.get(date);
      ids.forEach((id) => lastUsed.set(id, day));
      result.push({ date, assets: ids });
      continue;
    }
    const candidates = assets
      .filter((a) => !lastUsed.has(a.id) || day - lastUsed.get(a.id) >= 30)
      .filter(
        (a) =>
          !history.some((r) => {
            const gap = (Date.parse(`${r.date}T00:00:00Z`) - start) / DAY - day;
            return gap > 0 && gap < 30 && r.assets.includes(a.id);
          }),
      )
      .sort((a, b) => identityKey(`${date}:${a.id}`).localeCompare(identityKey(`${date}:${b.id}`)));
    const chosen = [],
      countries = new Set();
    for (const diverse of [true, false])
      for (const a of candidates) {
        if (chosen.length === 5) break;
        if (chosen.includes(a) || (diverse && countries.has(a.country))) continue;
        chosen.push(a);
        countries.add(a.country);
      }
    if (chosen.length !== 5)
      throw new HttpError(400, 'The pool cannot satisfy the 30-day cooldown.');
    chosen.forEach((a) => lastUsed.set(a.id, day));
    result.push({ date, assets: chosen.map((a) => a.id) });
  }
  return result;
}
