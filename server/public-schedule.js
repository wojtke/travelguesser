import { DAY, publicId, identityKey, scheduleDailies, searchPrefixes } from './public-content.js';
import { HttpError, gameSettings } from './game.js';

export const assetPhoto = (a) => ({
  assetId: a.id,
  storageGameId: 'official-library',
  key: a.key,
  lat: a.lat,
  lng: a.lng,
  caption: a.caption || a.credit.title,
  credit: a.credit,
});

// Shared by the operator UI and seed tool. A lease serializes schedule extensions
// across Cloud Run instances; every write verifies the lease and preserves dates.
export async function prepareDailies(data, startDate, days = 365) {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  if (
    !Number.isFinite(start) ||
    new Date(start).toISOString().slice(0, 10) !== startDate ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > 366
  )
    throw new HttpError(400, 'Choose a valid date and up to 366 days.');
  return withSchedulerLease(data, async (checkLease) => {
    const assets = await data.list('officialAssets', {
      filters: [['status', '==', 'approved']],
      limit: 1000,
    });
    const dateAt = (n) => new Date(start + n * DAY).toISOString().slice(0, 10);
    const history = await data.list('dailyChallenges', {
      order: 'date',
      direction: 'asc',
      filters: [
        ['date', '>=', dateAt(-30)],
        ['date', '<=', dateAt(days + 30)],
      ],
      limit: 430,
    });
    const schedule = scheduleDailies(assets, startDate, days, history),
      lookup = new Map(assets.map((a) => [a.id, a]));
    let created = 0;
    for (const entry of schedule) {
      const didCreate = await data.transaction(async (t) => {
        await checkLease(t);
        const manifest = `dailyChallenges/${entry.date}`;
        if (await t.get(manifest)) return false;
        const id = `daily-${entry.date}`,
          title = `Daily challenge · ${entry.date}`;
        t.set(`publications/${id}`, {
          id,
          title,
          kind: 'daily',
          dailyDate: entry.date,
          hostName: 'TripGuessr',
          ownerUid: null,
          state: 'published',
          tags: ['World'],
          searchPrefixes: searchPrefixes(title, ['World']),
          settings: gameSettings({ timeLimitSeconds: 60 }),
          createdAt: Date.now(),
          publishedAt: Date.parse(`${entry.date}T00:00:00Z`),
          photos: entry.assets.map((id) => assetPhoto(lookup.get(id))),
        });
        t.set(manifest, {
          id: entry.date,
          publicationId: id,
          date: entry.date,
          assets: entry.assets,
        });
        return true;
      });
      if (didCreate) created++;
    }
    return { created, startDate, days: schedule.length };
  });
}

async function withSchedulerLease(data, work) {
  const token = publicId(),
    key = 'publicControl/scheduler';
  await data.transaction(async (t) => {
    const lease = await t.get(key);
    if (lease?.until > Date.now())
      throw new HttpError(409, 'Another schedule is being prepared. Try again later.');
    t.set(key, { token, until: Date.now() + 15 * 60_000 });
  });
  try {
    return await work(async (t) => {
      const lease = await t.get(key);
      if (lease?.token !== token || lease.until <= Date.now())
        throw new HttpError(409, 'Schedule lease expired; retry to continue.');
    });
  } finally {
    await data.transaction(async (t) => {
      if ((await t.get(key))?.token === token) t.delete(key);
    });
  }
}

// Never change a released challenge. Replace only withdrawn photos in future sets,
// checking both earlier and later dates so replacement does not break cooldown.
export async function repairFutureDailies(data) {
  return withSchedulerLease(data, async (checkLease) => {
    const today = new Date().toISOString().slice(0, 10),
      start = Date.parse(`${today}T00:00:00Z`);
    const assets = await data.list('officialAssets', {
      filters: [['status', '==', 'approved']],
      limit: 1000,
    });
    const lookup = new Map(assets.map((a) => [a.id, a]));
    const history = await data.list('dailyChallenges', {
      order: 'date',
      direction: 'asc',
      limit: 430,
      filters: [
        ['date', '>=', new Date(start - 30 * DAY).toISOString().slice(0, 10)],
        ['date', '<=', new Date(start + 396 * DAY).toISOString().slice(0, 10)],
      ],
    });
    let repaired = 0;
    for (const entry of history) {
      if (entry.date <= today || entry.assets.every((id) => lookup.has(id))) continue;
      const original = [...entry.assets];
      for (let i = 0; i < entry.assets.length; i++) {
        if (lookup.has(entry.assets[i])) continue;
        const forbidden = new Set(
          history
            .filter((r) => Math.abs(Date.parse(r.date) - Date.parse(entry.date)) < 30 * DAY)
            .flatMap((r) => r.assets),
        );
        const replacement = assets
          .filter((a) => !forbidden.has(a.id))
          .sort((a, b) =>
            identityKey(`${entry.date}:${a.id}`).localeCompare(
              identityKey(`${entry.date}:${b.id}`),
            ),
          )[0];
        if (!replacement)
          throw new HttpError(409, 'More approved spare photos are needed to repair future dates.');
        entry.assets[i] = replacement.id;
      }
      await data.transaction(async (t) => {
        await checkLease(t);
        const key = `dailyChallenges/${entry.date}`,
          current = await t.get(key),
          pubKey = `publications/${entry.publicationId}`,
          p = await t.get(pubKey);
        if (!p || p.publishedAt <= Date.now() || current.assets.join(',') !== original.join(','))
          throw new HttpError(409, 'The schedule changed; retry the repair.');
        t.set(key, entry);
        t.set(pubKey, {
          ...p,
          photos: entry.assets.map((id) => assetPhoto(lookup.get(id))),
          repairedAt: Date.now(),
        });
      });
      repaired++;
    }
    return { repaired };
  });
}
