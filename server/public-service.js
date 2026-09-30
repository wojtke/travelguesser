import { publicData } from './public-data.js';
import {
  DAY,
  alive,
  millis,
  publicId,
  identityKey,
  publicationInput,
  checkPublication,
  publicEdition,
  publicCredits,
  scoreOrder,
} from './public-content.js';
import {
  HttpError,
  cleanText,
  newRun,
  publicRun,
  applyGuess,
  beginRound,
  roundDeadline,
} from './game.js';
import { resultSummary, shareSnapshot } from './results.js';
import { newLive, getLive, validateDraft, canViewLive } from './live.js';

export function createPublicService(store, log = () => {}) {
  const data = publicData(store);
  const actorKey = (actor) => (actor.uid ? `u_${identityKey(actor.uid)}` : `p_${actor.playerId}`);
  const path = (id, collection, key) => `publications/${id}/${collection}/${key}`;
  const gamePath = (id) => `publications/${id}`;
  const profilePath = (uid) => `publicProfiles/${identityKey(uid)}`;
  const browserKey = (actor) => `p_${actor.playerId}`;
  const actor = (req) => ({ uid: req.user?.uid, playerId: req.playerId });
  async function edition(id, reader = data) {
    let p = checkPublication(await reader.get(gamePath(id)));
    if (p.sourceGameId) {
      const source = await (reader === data
        ? store.getGame(p.sourceGameId)
        : reader.get(`games/${p.sourceGameId}`));
      if (!source || (source.status && source.status !== 'ready') || source.sharing === false)
        throw new HttpError(404, 'This public trip is unavailable.');
      p = { ...p, sourceSharingVersion: source.sharingVersion || 0 };
    }
    const control = await reader.get('publicControl/assets');
    if (p.photos.some((p) => p.assetId && control?.disabled?.includes(p.assetId)))
      throw new HttpError(404, 'This challenge was withdrawn because a photo is unavailable.');
    return p;
  }
  function game(p) {
    return { ...p, createdAt: p.publishedAt };
  }
  function runView(p, run) {
    return run
      ? {
          ...publicRun(game(p), run),
          ranked: !!run.ranked,
          rankReason: run.rankReason || '',
          results: run.results.map((r) => ({
            ...r,
            credit: publicCredits(p.photos[r.photoIndex]),
          })),
          photoUrl: run.completed ? null : `/api/publications/${p.id}/photos/${run.results.length}`,
        }
      : null;
  }
  async function publish(sourceId, uid, input) {
    const fields = publicationInput(input),
      id = publicId();
    return data.transaction(async (t) => {
      const source = await t.get(`games/${sourceId}`),
        profile = await t.get(profilePath(uid));
      if (!source || source.ownerUid !== uid)
        throw new HttpError(403, 'This trip belongs to another creator.');
      if ((source.status && source.status !== 'ready') || source.sharing === false)
        throw new HttpError(409, 'Finish uploading and enable sharing first.');
      if (profile?.suspended)
        throw new HttpError(403, 'Publishing is suspended. See your moderation notices.');
      const previous = source.publicationId ? await t.get(gamePath(source.publicationId)) : null;
      if (previous?.blocked)
        throw new HttpError(
          403,
          'This edition was removed by moderation. Use Contact to request review.',
        );
      if (previous?.state === 'published') return publicEdition(previous);
      const date = new Date().toISOString().slice(0, 10),
        used = profile?.publishDate === date ? profile.publishCount : 0;
      if (used >= 5) throw new HttpError(429, 'You can publish five trips per day.');
      const p = previous
        ? { ...previous, state: 'published' }
        : {
            id,
            ...fields,
            ownerUid: uid,
            sourceGameId: source.id,
            kind: 'community',
            state: 'published',
            createdAt: Date.now(),
            publishedAt: Date.now(),
            rightsConfirmedAt: Date.now(),
            termsVersion: '2026-09-30',
            photos: source.photos.map((photo) => ({ ...photo, storageGameId: source.id })),
          };
      t.set(gamePath(p.id), p);
      t.set(`games/${sourceId}`, { ...source, publicationId: p.id });
      t.set(profilePath(uid), {
        ...profile,
        id: identityKey(uid),
        createdAt: profile?.createdAt || Date.now(),
        nickname: fields.hostName,
        publishDate: date,
        publishCount: used + 1,
      });
      return publicEdition(p);
    });
  }
  async function unpublish(id, uid) {
    return data.transaction(async (t) => {
      const p = await t.get(gamePath(id));
      if (!p || p.ownerUid !== uid)
        throw new HttpError(403, 'This trip belongs to another creator.');
      t.set(gamePath(id), { ...p, state: 'unlisted', roomEpoch: (p.roomEpoch || 0) + 1 });
    });
  }
  async function eligibility(p, a, reader = data) {
    const claims = await Promise.all(
      [...new Set([actorKey(a), browserKey(a)])].map((key) =>
        reader.get(path(p.id, 'rankClaims', key)),
      ),
    );
    return (
      !!a.uid &&
      a.uid !== p.ownerUid &&
      !claims.some((c) => alive(c)) &&
      (!p.dailyDate || p.dailyDate === new Date().toISOString().slice(0, 10))
    );
  }
  async function markExposure(t, id, a, reason) {
    for (const key of new Set([actorKey(a), browserKey(a)])) {
      const claim = await t.get(path(id, 'rankClaims', key));
      if (!alive(claim))
        t.set(path(id, 'rankClaims', key), {
          reason,
          createdAt: Date.now(),
          ...(key.startsWith('p_') ? { expiresAt: new Date(Date.now() + 30 * DAY) } : {}),
        });
    }
  }
  async function join(id, a, input) {
    const name = cleanText(input.name, 24, 'Nickname');
    return data.transaction(async (t) => {
      const p = await edition(id, t),
        key = actorKey(a),
        runKey = path(id, 'publicRuns', key);
      const old = await t.get(runKey);
      if (alive(old) && !input.restart) return runView(p, old);
      if (
        input.ranked &&
        (input.restart || !a.uid || input.consent !== true || !(await eligibility(p, a, t)))
      )
        throw new HttpError(
          409,
          'Ranked play needs sign-in, public-score consent, and an unused first attempt. You can still play for practice.',
        );
      const profile = a.uid ? await t.get(profilePath(a.uid)) : null;
      if (profile?.suspended && input.ranked)
        throw new HttpError(403, 'Public score submission is suspended.');
      const run = {
        ...newRun(game(p), name),
        ranked: !!input.ranked,
        expiresAt: new Date(Date.now() + 30 * DAY),
        ...(p.dailyDate && input.ranked ? { attemptDeadline: Date.now() + 30 * 60_000 } : {}),
      };
      await markExposure(t, id, a, input.ranked ? 'ranked' : 'practice');
      t.set(runKey, run);
      if (a.uid)
        t.set(profilePath(a.uid), {
          ...profile,
          id: identityKey(a.uid),
          createdAt: profile?.createdAt || Date.now(),
          nickname: name,
        });
      return runView(p, run);
    });
  }
  async function updateRun(id, a, operation, input = {}) {
    return data.transaction(async (t) => {
      const p = await edition(id, t),
        key = actorKey(a),
        runKey = path(id, 'publicRuns', key);
      let run = await t.get(runKey),
        result;
      if (!alive(run)) {
        if (operation === 'get') return { p, run: null };
        throw new HttpError(403, 'Start a game first.');
      }
      let changed = false;
      if (!run.completed && run.attemptDeadline && Date.now() >= run.attemptDeadline) {
        run = { ...run, ranked: false, rankReason: 'The 30-minute ranked attempt expired.' };
        while (!run.completed) {
          run = {
            ...run,
            roundStartedAt: run.attemptDeadline - p.settings.timeLimitSeconds * 1000,
          };
          run = applyGuess(
            game(p),
            run,
            { round: run.results.length, timedOut: true },
            run.attemptDeadline,
          ).run;
        }
        changed = true;
      }
      if (operation === 'round') {
        const next = beginRound(run, input.round);
        changed ||= next !== run;
        run = next;
      } else if (operation === 'guess') {
        const next = applyGuess(game(p), run, input);
        changed ||= next.run !== run;
        run = next.run;
        result = next.result;
      } else if (
        !run.completed &&
        roundDeadline(game(p), run) &&
        Date.now() >= roundDeadline(game(p), run)
      ) {
        const next = applyGuess(game(p), run, { round: run.results.length, timedOut: true });
        run = next.run;
        result = next.result;
        changed = true;
      }
      if (changed) {
        const claimKey = path(id, 'rankClaims', key),
          claim = await t.get(claimKey);
        if (run.completed && run.ranked && (await t.get(profilePath(a.uid)))?.suspended)
          run = {
            ...run,
            ranked: false,
            rankReason: 'Public score submission is suspended. Use Contact to request review.',
          };
        if (run.completed && run.ranked && !claim?.scoreId && !claim?.withdrawn) {
          const score = {
            ...resultSummary(run),
            ownerKey: key,
            id: run.publicId,
            createdAt: Date.now(),
          };
          t.set(path(id, 'publicScores', score.id), { ...score, sortKey: scoreOrder(score) });
          t.set(claimKey, { ...claim, scoreId: score.id });
          t.set(`${profilePath(a.uid)}/scores/${id}`, {
            id,
            title: p.title,
            scoreId: score.id,
            createdAt: Date.now(),
          });
        }
        t.set(runKey, run);
      }
      return { p, run, result };
    });
  }
  async function board(id, cursor) {
    await edition(id);
    const rows = await data.list(path(id, 'publicScores', '').slice(0, -1), {
      order: 'sortKey',
      direction: 'asc',
      cursor,
      limit: 20,
    });
    return rows;
  }
  async function withdraw(id, uid) {
    await data.transaction(async (t) => {
      const key = `u_${identityKey(uid)}`,
        claimKey = path(id, 'rankClaims', key),
        claim = await t.get(claimKey);
      if (claim?.scoreId) t.delete(path(id, 'publicScores', claim.scoreId));
      t.set(claimKey, { ...claim, withdrawn: true });
      t.delete(`${profilePath(uid)}/scores/${id}`);
    });
  }
  async function photo(p, photo) {
    if (photo.assetId) {
      const asset = await data.get(`officialAssets/${photo.assetId}`);
      if (asset?.status !== 'approved') throw new HttpError(404, 'This photo was withdrawn.');
    }
    return store.getPhoto(photo.storageGameId || p.sourceGameId || p.id, photo.key);
  }
  async function room(id, liveId, reader = data) {
    const p = await edition(id, reader),
      l = await reader.get(path(id, 'publicRooms', liveId));
    if (!alive(l) || (l?.phase === 'lobby' && l.idleUntil <= Date.now()))
      throw new HttpError(410, 'This lobby expired. Start a new session.');
    if (l.accessEpoch !== `${p.roomEpoch || 0}:${p.sourceSharingVersion || 0}`)
      throw new HttpError(410, 'This room ended when sharing was paused.');
    const g = {
      ...game(p),
      ownerUid: l.hostUid,
      hostName: l.hostName,
      live: { ...l, expiresAt: millis(l.expiresAt) },
    };
    getLive(g, liveId);
    return g;
  }
  async function createRoom(id, a, input) {
    return data.transaction(async (t) => {
      const p = await edition(id, t),
        profile = await t.get(profilePath(a.uid));
      if (profile?.suspended) throw new HttpError(403, 'Hosting is suspended.');
      const previous = profile?.activeRoom;
      if (previous) {
        let old;
        try {
          old = (await room(previous.publicationId, previous.id, t)).live;
        } catch (e) {
          if (![404, 410].includes(e.status)) throw e;
        }
        if (
          alive(old) &&
          old.phase !== 'finished' &&
          (old.phase !== 'lobby' || old.idleUntil > Date.now())
        )
          throw new HttpError(409, 'End your existing room before opening another.');
      }
      const date = new Date().toISOString().slice(0, 10),
        count = profile?.roomDate === date ? profile.roomCount : 0;
      if (count >= 10) throw new HttpError(429, 'You can create ten friend rooms per day.');
      const hostName = cleanText(input.name || profile?.nickname || 'Host', 24, 'Host nickname');
      const g = newLive({ ...game(p), ownerUid: a.uid, hostName }, input.settings || input);
      const l = {
        ...g.live,
        hostUid: a.uid,
        accessEpoch: `${p.roomEpoch || 0}:${p.sourceSharingVersion || 0}`,
        hostName,
        idleUntil: Date.now() + 15 * 60_000,
        expiresAt: new Date(g.live.expiresAt),
      };
      t.set(path(id, 'publicRooms', l.id), l);
      t.set(profilePath(a.uid), {
        ...profile,
        id: identityKey(a.uid),
        createdAt: profile?.createdAt || Date.now(),
        roomDate: date,
        roomCount: count + 1,
        activeRoom: { publicationId: id, id: l.id },
      });
      // Hosts can see photos while spectating, so hosting also consumes ranked eligibility.
      await markExposure(t, id, a, 'live');
      return { ...g, live: { ...l, expiresAt: millis(l.expiresAt) } };
    });
  }
  async function mutateRoom(id, liveId, fn, a, action) {
    return data.transaction(async (t) => {
      const g = await room(id, liveId, t);
      const records = await t.query(
        path(id, 'publicDrafts', '').slice(0, -1),
        [['liveId', '==', liveId]],
        20,
      );
      const drafts = Object.fromEntries(
        records.filter((d) => alive(d)).map((d) => [d.playerId, d]),
      );
      const next = fn(g, drafts);
      if (a && action === 'join') await markExposure(t, id, a, 'live');
      if (next !== g)
        t.set(path(id, 'publicRooms', liveId), {
          ...next.live,
          expiresAt: new Date(next.live.expiresAt),
          idleUntil: Date.now() + 15 * 60_000,
        });
      return next;
    });
  }
  async function saveDraft(id, liveId, a, input) {
    return data.transaction(async (t) => {
      const g = await room(id, liveId, t),
        key = path(id, 'publicDrafts', `${liveId}_${a.playerId}`);
      const previous = await t.get(key),
        next = validateDraft(g, liveId, a, input, previous);
      if (next !== previous) t.set(key, next);
      return next;
    });
  }
  // Reuse the battle-tested stream fanout/timer implementation, but watch separate room documents.
  const streamStore = {
    getLiveDraft: (id, liveId, playerId) =>
      data.get(path(id, 'publicDrafts', `${liveId}_${playerId}`)),
    mutateLive: mutateRoom,
    watchGame(idAndRoom, onData, onError) {
      const [id, liveId] = idAndRoom.split(':');
      const roomKey = path(id, 'publicRooms', liveId),
        publicationKey = gamePath(id);
      const keys = new Set([roomKey, publicationKey, 'publicControl/assets']),
        values = new Map(),
        stops = [];
      let stopped = false,
        generation = 0,
        sourceKey;
      const reader = { get: async (key) => values.get(key) || null };
      const refresh = async () => {
        if (stopped || [...keys].some((key) => !values.has(key))) return;
        const version = ++generation;
        try {
          const g = await room(id, liveId, reader);
          if (!stopped && generation === version) onData(g);
        } catch (e) {
          if (!stopped && generation === version) e.status ? onData(null) : onError(e);
        }
      };
      const watch = (key) =>
        stops.push(
          data.watch(
            key,
            (value) => {
              values.set(key, value);
              if (key === publicationKey && value?.sourceGameId && !sourceKey) {
                sourceKey = `games/${value.sourceGameId}`;
                keys.add(sourceKey);
                watch(sourceKey);
              }
              refresh();
            },
            onError,
          ),
        );
      [...keys].forEach(watch);
      return () => {
        stopped = true;
        stops.forEach((stop) => stop());
      };
    },
  };
  async function share(id, a, source) {
    return data.transaction(async (t) => {
      const p = await edition(id, t);
      let run, writeKey;
      if (source === 'solo') {
        writeKey = path(id, 'publicRuns', actorKey(a));
        run = await t.get(writeKey);
        if (!alive(run)) throw new HttpError(404, 'This run has expired.');
      } else {
        const g = await room(id, source, t);
        if (
          !canViewLive(g, a) ||
          !g.live.players[a.playerId]?.active ||
          g.live.phase !== 'finished'
        )
          throw new HttpError(403, 'Finish this room before sharing results.');
        run = {
          ...g.live.players[a.playerId],
          completed: true,
          order: g.live.order,
          finishedAt: g.live.finishedAt,
        };
      }
      const token = run.shareId || publicId();
      const old = await t.get(path(id, 'publicSharedResults', token));
      if (alive(old)) return token;
      const record = shareSnapshot(p, a.playerId, source, run);
      t.set(path(id, 'publicSharedResults', token), { ...record, publicEdition: true });
      if (writeKey) t.set(writeKey, { ...run, shareId: token });
      else {
        const key = path(id, 'publicRooms', source),
          l = await t.get(key);
        t.set(key, {
          ...l,
          players: { ...l.players, [a.playerId]: { ...l.players[a.playerId], shareId: token } },
        });
      }
      return token;
    });
  }
  return {
    data,
    actor,
    actorKey,
    path,
    profilePath,
    edition,
    game,
    runView,
    publish,
    unpublish,
    eligibility,
    join,
    updateRun,
    board,
    withdraw,
    photo,
    room,
    createRoom,
    mutateRoom,
    saveDraft,
    streamStore,
    share,
    log,
  };
}
