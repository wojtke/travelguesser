import { retainedRun } from './demo-retention.js';
import { EventEmitter } from 'node:events';
import { HttpError } from './game.js';
import { getLive, validateDraft, canViewLive } from './live.js';
import { resultId, shareSnapshot } from './results.js';
const expiry = (value) => value?.toMillis?.() ?? new Date(value).getTime();
function checked(game) {
  if (!game || (game.status && game.status !== 'ready'))
    throw new HttpError(404, 'This trip is no longer available.');
  return game;
}
function sourceRun(game, actor, source, solo) {
  if (game.sharing === false) throw new HttpError(403, 'Sharing is paused for this trip.');
  if (source === 'solo') return retainedRun(game.id, solo);
  const l = getLive(game, source);
  if (!canViewLive(game, actor) || !l.players[actor.playerId]?.active)
    throw new HttpError(403, 'Join this lobby first.');
  if (l.phase !== 'finished')
    throw new HttpError(409, 'Finish the session before sharing results.');
  const p = l.players[actor.playerId];
  return {
    ...p,
    tripSnapshot: l.tripSnapshot || game.originalTrip,
    order: l.order,
    completed: true,
    finishedAt: l.finishedAt,
  };
}
export function installStoreFeatures(LocalStore, CloudStore) {
  LocalStore.prototype.watchGame = function (id, onData, onError = () => {}) {
    this.events ||= new EventEmitter().setMaxListeners(60);
    const callback = (data) => onData(data.games[id] || null);
    this.events.on('change', callback);
    this.read().then(callback).catch(onError);
    return () => this.events.off('change', callback);
  };
  LocalStore.prototype.mutateLive = function (id, liveId, fn) {
    return this.mutate((d) => {
      const g = checked(d.games[id]);
      getLive(g, liveId);
      const drafts = Object.fromEntries(
        Object.values(d.liveDrafts || {})
          .filter((r) => r.liveId === liveId)
          .map((r) => [r.playerId, r]),
      );
      return (d.games[id] = fn(g, drafts));
    });
  };
  LocalStore.prototype.saveLiveDraft = function (id, liveId, actor, input) {
    return this.mutate((d) => {
      const g = checked(d.games[id]);
      d.liveDrafts ||= {};
      const key = `${id}:${liveId}:${actor.playerId}`;
      return (d.liveDrafts[key] = validateDraft(g, liveId, actor, input, d.liveDrafts[key]));
    });
  };
  LocalStore.prototype.getLiveDraft = async function (id, liveId, playerId) {
    return (await this.read()).liveDrafts?.[`${id}:${liveId}:${playerId}`] || null;
  };
  CloudStore.prototype.watchGame = function (id, onData, onError) {
    return this.gameRef(id).onSnapshot((s) => onData(s.data() || null), onError);
  };
  CloudStore.prototype.mutateLive = function (id, liveId, fn) {
    return this.db.runTransaction(async (t) => {
      const ref = this.gameRef(id),
        g = checked((await t.get(ref)).data());
      getLive(g, liveId);
      const docs = await t.get(
        ref.collection('liveDrafts').where('liveId', '==', liveId).limit(20),
      );
      const drafts = Object.fromEntries(
        docs.docs.map((s) => {
          const d = s.data();
          return [d.playerId, d];
        }),
      );
      const next = fn(g, drafts);
      if (next !== g) t.set(ref, next);
      return next;
    });
  };
  CloudStore.prototype.saveLiveDraft = function (id, liveId, actor, input) {
    return this.db.runTransaction(async (t) => {
      const ref = this.gameRef(id),
        draftRef = ref.collection('liveDrafts').doc(`${liveId}_${actor.playerId}`);
      const [g, d] = await Promise.all([t.get(ref), t.get(draftRef)]);
      const previous = d.data(),
        next = validateDraft(checked(g.data()), liveId, actor, input, previous);
      if (next !== previous) t.set(draftRef, next);
      return next;
    });
  };
  CloudStore.prototype.getLiveDraft = async function (id, liveId, playerId) {
    return (
      (await this.gameRef(id).collection('liveDrafts').doc(`${liveId}_${playerId}`).get()).data() ||
      null
    );
  };
  LocalStore.prototype.createSharedResult = function (id, actor, source) {
    return this.mutate((d) => {
      const game = id === 'demo-trip' ? { id, title: 'World landmarks' } : checked(d.games[id]);
      const key = `${id}:${actor.playerId}`;
      const run = sourceRun(game, actor, source, d.runs[key]);
      if (!run?.completed) throw new HttpError(409, 'Finish the game before sharing results.');
      d.sharedResults ||= {};
      const old = d.sharedResults[`${id}:${run.shareId}`];
      if (old && expiry(old.expiresAt) > Date.now()) return { token: run.shareId, record: old };
      const token = resultId(),
        record = shareSnapshot(game, actor.playerId, source, run);
      d.sharedResults[`${id}:${token}`] = record;
      if (source === 'solo') d.runs[key].shareId = token;
      else game.live.players[actor.playerId].shareId = token;
      return { token, record };
    });
  };
  CloudStore.prototype.createSharedResult = function (id, actor, source) {
    return this.db.runTransaction(async (t) => {
      const gameRef = this.gameRef(id),
        snap = await t.get(gameRef),
        game = id === 'demo-trip' ? { id, title: 'World landmarks' } : checked(snap.data());
      const runRef = this.runRef(id, actor.playerId),
        solo = source === 'solo' ? (await t.get(runRef)).data() : null;
      const run = sourceRun(game, actor, source, solo);
      if (!run?.completed) throw new HttpError(409, 'Finish the game before sharing results.');
      if (run.shareId) {
        const old = (await t.get(gameRef.collection('sharedResults').doc(run.shareId))).data();
        if (old && expiry(old.expiresAt) > Date.now()) return { token: run.shareId, record: old };
      }
      const token = resultId(),
        record = shareSnapshot(game, actor.playerId, source, run);
      t.create(gameRef.collection('sharedResults').doc(token), record);
      if (source === 'solo') t.update(runRef, { shareId: token });
      else {
        game.live.players[actor.playerId].shareId = token;
        t.set(gameRef, game);
      }
      return { token, record };
    });
  };
  LocalStore.prototype.getSharedResult = async function (id, token) {
    const r = (await this.read()).sharedResults?.[`${id}:${token}`];
    return r && expiry(r.expiresAt) > Date.now() ? r : null;
  };
  CloudStore.prototype.getSharedResult = async function (id, token) {
    const r = (await this.gameRef(id).collection('sharedResults').doc(token).get()).data();
    return r && expiry(r.expiresAt) > Date.now() ? r : null;
  };
}
