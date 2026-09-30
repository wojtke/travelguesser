import { randomBytes } from 'node:crypto';
import { DEMO_ID, DEMO_RETENTION_MS } from './demo-retention.js';
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function coordinates(value) {
  if (
    !value ||
    typeof value.lat !== 'number' ||
    typeof value.lng !== 'number' ||
    !Number.isFinite(value.lat) ||
    !Number.isFinite(value.lng) ||
    value.lat < -90 ||
    value.lat > 90 ||
    value.lng < -180 ||
    value.lng > 180
  ) {
    throw new HttpError(400, 'Choose a valid point on the map.');
  }
  return { lat: value.lat, lng: value.lng };
}

export function cleanText(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new HttpError(400, `${label} must be between 1 and ${max} characters.`);
  }
  return value.trim();
}

export function distanceKm(a, b) {
  const rad = (n) => (n * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

export function scoreGuess(distance) {
  return Math.round(5000 * Math.exp(-distance / 1500));
}

export const validSeconds = (value) => Number.isInteger(value) && value >= 1 && value <= 3600;
export function gameSettings(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new HttpError(400, 'Invalid game settings.');
  const settings = {
    mode: value.mode ?? 'solo',
    timeLimitSeconds: value.timeLimitSeconds ?? 0,
    shufflePhotos: value.shufflePhotos ?? false,
    timerMode: value.timerMode ?? (value.timeLimitSeconds ? 'fixed' : 'none'),
    afterFirstLockSeconds: value.afterFirstLockSeconds ?? 15,
    nextRoundControl: value.nextRoundControl ?? 'host',
  };
  if (
    !['solo', 'live'].includes(settings.mode) ||
    !['none', 'fixed', 'afterFirstLock'].includes(settings.timerMode) ||
    !(settings.timeLimitSeconds === 0 || validSeconds(settings.timeLimitSeconds)) ||
    (settings.timerMode === 'fixed' && !validSeconds(settings.timeLimitSeconds)) ||
    (settings.timerMode === 'afterFirstLock' && settings.mode !== 'live') ||
    !validSeconds(settings.afterFirstLockSeconds) ||
    !['host', 'anyPlayer'].includes(settings.nextRoundControl) ||
    typeof settings.shufflePhotos !== 'boolean'
  )
    throw new HttpError(400, 'Choose a valid game mode, timer, and photo order.');
  if (settings.timerMode !== 'fixed') settings.timeLimitSeconds = 0;
  return settings;
}
export function photoOrder(game, shuffled = game.settings?.shufflePhotos) {
  const order = game.photos.map((_, i) => i);
  if (shuffled)
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
  return order;
}
// Keep each playthrough on the photos and rules it started with. The first edit
// also saves a fallback for runs created before snapshots were introduced.
export function tripSnapshot(game) {
  return {
    title: game.title || '',
    hostName: game.hostName || '',
    photos: game.photos,
    settings: gameSettings(game.settings),
    tripRevision: game.tripRevision || 0,
  };
}
export function runGame(game, run) {
  return run ? { ...game, ...(run.tripSnapshot || game.originalTrip || {}) } : game;
}
export function newRun(game, name, now = Date.now()) {
  return {
    tripSnapshot: tripSnapshot(game),
    ...(game.id === DEMO_ID ? { demoExpiresAt: new Date(now + DEMO_RETENTION_MS) } : {}),
    name,
    publicId: randomBytes(12).toString('base64url'),
    score: 0,
    results: [],
    completed: false,
    startedAt: now,
    gameId: game.id,
    order: photoOrder(game),
    roundStartedAt: now,
  };
}
export function roundDeadline(game, run) {
  game = runGame(game, run);
  return game.settings?.timeLimitSeconds && run.roundStartedAt
    ? run.roundStartedAt + game.settings.timeLimitSeconds * 1000
    : null;
}
export function beginRound(run, round, now = Date.now()) {
  if (!run) throw new HttpError(403, 'Join this game first.');
  if (round !== run.results.length)
    throw new HttpError(409, 'Refresh to continue the current round.');
  return !run.completed && run.roundStartedAt === null ? { ...run, roundStartedAt: now } : run;
}
export function applyGuess(game, run, input, now = Date.now()) {
  game = runGame(game, run);
  if (!Number.isInteger(input.round) || input.round < 0 || input.round >= game.photos.length) {
    throw new HttpError(400, 'Invalid round.');
  }
  // A retried request returns the original result, and can never replace a guess.
  if (input.round < run.results.length) return { run, result: run.results[input.round] };
  if (input.round !== run.results.length)
    throw new HttpError(409, 'Finish the current round first.');
  if (game.settings?.timeLimitSeconds && run.roundStartedAt === null)
    throw new HttpError(409, 'Start the next round first.');
  const expired = roundDeadline(game, run) !== null && now >= roundDeadline(game, run);
  if (input.timedOut && !expired) throw new HttpError(409, 'The round is still running.');
  const guess = expired ? null : coordinates(input);
  const photo = game.photos[run.order?.[input.round] ?? input.round];
  const actual = { lat: photo.lat, lng: photo.lng };
  const distance = guess ? distanceKm(guess, actual) : null;
  const result = {
    round: input.round,
    photoIndex: run.order?.[input.round] ?? input.round,
    durationMs: run.roundStartedAt
      ? Math.max(0, (expired ? roundDeadline(game, run) : now) - run.roundStartedAt)
      : null,
    submittedAt: expired ? roundDeadline(game, run) : now,
    guess,
    actual,
    distance,
    score: guess ? scoreGuess(distance) : 0,
    timedOut: expired,
    caption: photo.caption || '',
  };
  const results = [...run.results, result];
  const updated = {
    ...run,
    results,
    score: run.score + result.score,
    completed: results.length === game.photos.length,
    roundStartedAt: null,
  };
  if (updated.completed) updated.finishedAt = now;
  return { run: updated, result };
}

export function publicGame(game) {
  return {
    tripRevision: game.tripRevision || 0,
    id: game.id,
    title: game.title,
    hostName: game.hostName,
    rounds: game.photos.length,
    createdAt: game.createdAt,
    demo: !!game.demo,
    settings: gameSettings(game.settings),
    sharing: game.sharing !== false,
    liveId:
      game.live && game.live.phase !== 'finished' && game.live.expiresAt > Date.now()
        ? game.live.id
        : null,
  };
}

export function publicRun(game, run) {
  return {
    name: run.name,
    score: run.score,
    results: run.results,
    completed: run.completed,
    finishedAt: run.finishedAt ?? null,
    publicId: run.publicId ?? null,
    round: run.results.length,
    deadline: roundDeadline(game, run),
    serverNow: Date.now(),
    awaitingNext: run.roundStartedAt === null && !run.completed,
    photoUrl: run.completed ? null : `/api/games/${game.id}/photos/${run.results.length}`,
  };
}
