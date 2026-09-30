import { randomBytes } from 'node:crypto';
import { HttpError } from './game.js';
export const RESULT_RETENTION_MS = 30 * 86400_000;
export const resultId = () => randomBytes(16).toString('base64url');
export function roundSummary(result, index, order) {
  return {
    round: result.round ?? index,
    photoIndex: result.photoIndex ?? order?.[index] ?? index,
    score: result.score,
    distance: result.distance ?? null,
    durationMs: result.durationMs ?? null,
  };
}
export function resultSummary(run) {
  const rounds = (run.results || []).map((r, i) => roundSummary(r, i, run.order));
  return {
    id: run.publicId || null,
    tripRevision: run.tripSnapshot?.tripRevision || 0,
    name: run.name,
    score: run.score,
    finishedAt: run.finishedAt ?? null,
    durationMs:
      rounds.length && rounds.every((r) => r.durationMs !== null)
        ? rounds.reduce((n, r) => n + r.durationMs, 0)
        : null,
    rounds,
  };
}
export function shareSnapshot(game, playerId, source, run, now = Date.now()) {
  if (!run?.completed) throw new HttpError(409, 'Finish the game before sharing your results.');
  return {
    gameId: game.id,
    title: run.tripSnapshot?.title || game.originalTrip?.title || game.title,
    source,
    ownerPlayerId: playerId,
    ...resultSummary(run),
    createdAt: now,
    expiresAt: new Date(now + RESULT_RETENTION_MS),
  };
}
export function publicSharedResult(record) {
  const { title, name, score, finishedAt, durationMs, rounds, gameId, expiresAt } = record;
  return {
    title,
    name,
    score,
    finishedAt,
    durationMs,
    rounds,
    gameId,
    expiresAt: expiresAt?.toMillis?.() ?? new Date(expiresAt).getTime(),
  };
}
export function defaultTripTitle(name, number) {
  const first = String(name || '')
    .trim()
    .split(/\s+/)[0];
  return `${first ? first.slice(0, 50) + '’s' : 'Your'} trip #${number}`;
}
