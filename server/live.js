import { randomBytes } from 'node:crypto';
import {
  cleanText,
  coordinates,
  distanceKm,
  gameSettings,
  HttpError,
  photoOrder,
  scoreGuess,
  tripSnapshot,
} from './game.js';
import { resultSummary } from './results.js';
export const LIVE_LIMITS = { players: 20, lifetimeHours: 24, pollMs: 3000 };
export function newLive(game, input = {}, now = Date.now()) {
  if (game.live && game.live.phase !== 'finished' && game.live.expiresAt > now) return game;
  const settings = gameSettings({
    ...game.settings,
    ...input,
    ...(input.timeLimitSeconds !== undefined && input.timerMode === undefined
      ? { timerMode: input.timeLimitSeconds ? 'fixed' : 'none' }
      : {}),
    mode: 'live',
  });
  return {
    ...game,
    live: {
      tripSnapshot: tripSnapshot(game),
      id: randomBytes(16).toString('base64url'),
      protocolVersion: 2,
      revision: 0,
      phase: 'lobby',
      createdAt: now,
      expiresAt: now + 24 * 3600_000,
      settings,
      order: photoOrder(game, settings.shufflePhotos),
      round: 0,
      deadline: null,
      players: {},
    },
  };
}
export function liveGame(game) {
  return { ...game, ...(game.live?.tripSnapshot || game.originalTrip || {}) };
}
export function getLive(game, id, now = Date.now()) {
  if (!game?.live || game.live.id !== id)
    throw new HttpError(404, 'This lobby no longer exists. Ask the host for a new link.');
  if (game.live.expiresAt <= now)
    throw new HttpError(410, 'This live session expired. The host can open a new lobby.');
  return game.live;
}
export function canViewLive(game, actor) {
  return (
    (actor.uid === game.ownerUid && !!actor.uid) || !!game.live?.players[actor.playerId]?.active
  );
}
function finishRound(game, live, now, drafts = {}) {
  const photoIndex = live.order[live.round],
    photo = liveGame(game).photos[photoIndex],
    actual = { lat: photo.lat, lng: photo.lng };
  const players = Object.fromEntries(
    Object.entries(live.players).map(([id, p]) => {
      if (!live.roster.includes(id)) return [id, p];
      const draft = drafts[id];
      const guess =
        p.guess ||
        (live.protocolVersion === 2 && p.active && draft?.round === live.round
          ? draft.point
          : null);
      const submittedAt = p.submittedAt ?? now,
        distance = guess ? distanceKm(guess, actual) : null,
        score = guess ? scoreGuess(distance) : 0;
      const result = {
        round: live.round,
        photoIndex,
        guess,
        distance,
        score,
        actual,
        caption: photo.caption || '',
        durationMs: Math.max(0, submittedAt - live.startedAt),
        submittedAt,
        automatic: !p.guess,
      };
      return [id, { ...p, score: p.score + score, results: [...p.results, result] }];
    }),
  );
  return { ...live, phase: 'results', players };
}
export function expireLive(game, now = Date.now(), drafts = {}) {
  let live = game.live;
  if (live?.phase === 'preparing' && now >= live.startsAt) live = { ...live, phase: 'round' };
  if (live?.phase === 'round' && live.deadline && now >= live.deadline)
    live = finishRound(game, live, live.deadline, drafts);
  return live === game.live
    ? game
    : { ...game, live: { ...live, revision: (live.revision || 0) + 1 } };
}
export function updateLive(game, id, actor, action, input = {}, now = Date.now(), drafts = {}) {
  getLive(game, id, now);
  game = expireLive(game, now, drafts);
  let live = game.live;
  const host = !!actor.uid && actor.uid === game.ownerUid;
  const requireHost = () => {
    if (!host) throw new HttpError(403, 'Only the trip creator can control this lobby.');
  };
  if (action === 'join') {
    const name = cleanText(input.name, 24, 'Your name');
    if (live.players[actor.playerId]) return game;
    if (live.phase !== 'lobby')
      throw new HttpError(409, 'The game has started. Ask the host for a new lobby.');
    if (Object.keys(live.players).length >= LIVE_LIMITS.players)
      throw new HttpError(409, 'This lobby is full (20 players).');
    if (
      Object.values(live.players).some(
        (p) => p.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      )
    )
      throw new HttpError(409, 'That name is already in the lobby. Choose another nickname.');
    const marker = 1 + Math.max(0, ...Object.values(live.players).map((p) => p.marker || 0));
    live = {
      ...live,
      players: {
        ...live.players,
        [actor.playerId]: {
          id: randomBytes(9).toString('base64url'),
          marker,
          name,
          score: 0,
          results: [],
          guess: null,
          active: true,
        },
      },
    };
  } else if (action === 'start' || action === 'next') {
    if (action === 'start' || live.settings.nextRoundControl !== 'anyPlayer') requireHost();
    else if (!host && !live.players[actor.playerId]?.active)
      throw new HttpError(403, 'Only active players can start the next round.');
    if (
      input.round !== live.round ||
      (action === 'start' ? live.phase !== 'lobby' : live.phase !== 'results')
    )
      return game;
    const round = action === 'start' ? 0 : live.round + 1;
    if (round >= liveGame(game).photos.length)
      live = { ...live, phase: 'finished', finishedAt: now };
    else {
      const roster = Object.entries(live.players)
        .filter(([, p]) => p.active)
        .map(([id]) => id);
      if (!roster.length)
        throw new HttpError(409, 'At least one player must join before starting a round.');
      const startsAt = now + (live.protocolVersion === 2 ? 5000 : 0);
      live = {
        ...live,
        round,
        roster,
        phase: live.protocolVersion === 2 ? 'preparing' : 'round',
        startsAt,
        startedAt: startsAt,
        deadline: live.settings.timeLimitSeconds
          ? startsAt + live.settings.timeLimitSeconds * 1000
          : null,
        players: Object.fromEntries(
          Object.entries(live.players).map(([id, p]) => [
            id,
            { ...p, guess: null, submittedAt: null, ready: false },
          ]),
        ),
      };
    }
  } else if (action === 'ready') {
    if (
      input.round !== live.round ||
      !['preparing', 'round'].includes(live.phase) ||
      !live.players[actor.playerId]?.active
    )
      return game;
    const p = live.players[actor.playerId];
    if (p.ready) return game;
    live = { ...live, players: { ...live.players, [actor.playerId]: { ...p, ready: true } } };
  } else if (action === 'guess') {
    const p = live.players[actor.playerId];
    if (!p?.active) throw new HttpError(403, 'Join this lobby first.');
    if (live.phase === 'preparing') throw new HttpError(409, 'The round has not started yet.');
    if (live.phase !== 'round' || input.round !== live.round || p.guess) return game;
    const deadline =
      live.settings.timerMode === 'afterFirstLock' && !live.deadline
        ? now + live.settings.afterFirstLockSeconds * 1000
        : live.deadline;
    live = {
      ...live,
      deadline,
      players: {
        ...live.players,
        [actor.playerId]: { ...p, guess: coordinates(input), submittedAt: now },
      },
    };
    if (live.roster.every((id) => live.players[id].guess || !live.players[id].active))
      live = finishRound(game, live, now, drafts);
  } else if (action === 'remove' || action === 'leave') {
    if (action === 'remove') requireHost();
    const key =
      action === 'leave'
        ? actor.playerId
        : Object.keys(live.players).find((id) => live.players[id].id === input.playerId);
    if (!key || !live.players[key]) return game;
    const players = { ...live.players };
    if (live.phase === 'lobby') delete players[key];
    else players[key] = { ...players[key], active: false };
    live = { ...live, players };
    if (
      live.phase === 'round' &&
      live.roster.every((id) => live.players[id].guess || !live.players[id].active)
    )
      live = finishRound(game, live, now, drafts);
  } else if (action === 'reveal') {
    requireHost();
    if (input.round === live.round && live.phase === 'round')
      live = finishRound(game, live, now, drafts);
  } else if (action === 'end') {
    requireHost();
    if (live.phase === 'round') live = finishRound(game, live, now, drafts);
    live = { ...live, phase: 'finished', finishedAt: now };
  } else throw new HttpError(400, 'Unknown lobby action.');
  return live === game.live
    ? game
    : { ...game, live: { ...live, revision: (live.revision || 0) + 1 } };
}
export function validateDraft(game, id, actor, input, previous, now = Date.now()) {
  const l = getLive(game, id, now),
    p = l.players[actor.playerId];
  if (game.sharing === false || !p?.active)
    throw new HttpError(403, 'You no longer have access to this lobby.');
  if (
    l.protocolVersion !== 2 ||
    input.round !== l.round ||
    !['preparing', 'round'].includes(l.phase) ||
    now < l.startsAt ||
    (l.deadline && now >= l.deadline) ||
    p.guess
  )
    throw new HttpError(409, 'This round is not accepting draft guesses.');
  if (!Number.isSafeInteger(input.version) || input.version < 1)
    throw new HttpError(400, 'Invalid draft version.');
  if (previous?.round === input.round && input.version <= previous.version) return previous;
  return {
    liveId: id,
    playerId: actor.playerId,
    round: input.round,
    version: input.version,
    point: coordinates(input),
    savedAt: now,
    expiresAt: new Date(l.expiresAt),
  };
}
export function publicLive(game, actor, now = Date.now()) {
  game = liveGame(game);
  const l = game.live,
    me = l.players[actor.playerId],
    isHost = !!actor.uid && actor.uid === game.ownerUid;
  const joined = canViewLive(game, actor),
    revealed = joined && ['results', 'finished'].includes(l.phase);
  return {
    id: l.id,
    protocolVersion: l.protocolVersion || 1,
    revision: l.revision || 0,
    gameId: game.id,
    title: game.title,
    hostName: game.hostName,
    phase: l.phase,
    round: l.round,
    rounds: game.photos.length,
    settings: gameSettings(l.settings),
    startsAt: l.startsAt ?? null,
    deadline: l.deadline,
    expiresAt: l.expiresAt,
    serverNow: now,
    isHost,
    joined: !!me?.active,
    canAdvance: isHost || (l.settings.nextRoundControl === 'anyPlayer' && !!me?.active),
    me: me
      ? {
          id: me.id,
          marker: me.marker,
          name: me.name,
          active: me.active,
          guess: me.guess,
          score: me.score,
          results: me.active ? me.results : [],
        }
      : null,
    playerCount: Object.keys(l.players).length,
    limits: LIVE_LIMITS,
    players: joined
      ? Object.values(l.players).map((p) => ({
          id: p.id,
          marker: p.marker || 1,
          name: p.name,
          active: p.active,
          score: p.score,
          submitted: !!p.guess,
          ready: !!p.ready,
        }))
      : [],
    standings: joined
      ? Object.values(l.players)
          .map((p) => ({
            ...resultSummary({
              ...p,
              order: l.order,
              finishedAt:
                l.finishedAt ??
                (p.results.length === game.photos.length ? p.results.at(-1)?.submittedAt : null),
            }),
            id: p.id,
            marker: p.marker || 1,
            active: p.active,
          }))
          .sort((a, b) => b.score - a.score)
      : [],
    results: revealed
      ? Object.values(l.players)
          .flatMap((p) => {
            const r = p.results.find((r) => r.round === l.round);
            return r
              ? [{ id: p.id, marker: p.marker || 1, name: p.name, total: p.score, ...r }]
              : [];
          })
          .sort((a, b) => b.score - a.score)
      : [],
    photoUrl:
      joined && !['lobby'].includes(l.phase) && l.startedAt
        ? `/api/games/${game.id}/live/${l.id}/photos/${l.round}`
        : null,
  };
}
