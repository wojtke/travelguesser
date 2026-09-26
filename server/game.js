export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function coordinates(value) {
  if (!value || typeof value.lat !== 'number' || typeof value.lng !== 'number' ||
      !Number.isFinite(value.lat) || !Number.isFinite(value.lng) ||
      value.lat < -90 || value.lat > 90 || value.lng < -180 || value.lng > 180) {
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
  const rad = n => n * Math.PI / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

export function scoreGuess(distance) { return Math.round(5000 * Math.exp(-distance / 1500)); }

export function applyGuess(game, run, input) {
  const guess = coordinates(input);
  if (!Number.isInteger(input.round) || input.round < 0 || input.round >= game.photos.length) {
    throw new HttpError(400, 'Invalid round.');
  }
  // A retried request returns the original result, and can never replace a guess.
  if (input.round < run.results.length) return { run, result: run.results[input.round] };
  if (input.round !== run.results.length) throw new HttpError(409, 'Finish the current round first.');
  const photo = game.photos[input.round];
  const actual = { lat: photo.lat, lng: photo.lng };
  const distance = distanceKm(guess, actual);
  const result = { round: input.round, guess, actual, distance, score: scoreGuess(distance), caption: photo.caption || '' };
  const results = [...run.results, result];
  const updated = { ...run, results, score: run.score + result.score, completed: results.length === game.photos.length };
  if (updated.completed) updated.finishedAt = Date.now();
  return { run: updated, result };
}

export function publicGame(game) {
  return { id: game.id, title: game.title, hostName: game.hostName, rounds: game.photos.length, createdAt: game.createdAt, demo: !!game.demo };
}

export function publicRun(game, run) {
  return { name: run.name, score: run.score, results: run.results, completed: run.completed, round: run.results.length,
    photoUrl: run.completed ? null : `/api/games/${game.id}/photos/${run.results.length}` };
}
