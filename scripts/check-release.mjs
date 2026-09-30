// Read-only post-deployment checks. No gameplay records, cookies or analytics identities.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { appendFile } from 'node:fs/promises';

export async function checkRelease(base, { fetchImpl = fetch, now = Date.now } = {}) {
  assert.equal(new URL(base).protocol, 'https:');
  const get = (path) => fetchImpl(new URL(path, base), { signal: AbortSignal.timeout(10000) });
  const response = await get('/api/health');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'ok');
  const home = await get('/');
  assert.equal(home.status, 200);
  const html = await home.text();
  const asset = html.match(/src="(\/assets\/[^"<>]+\.js)"/);
  assert.ok(asset, 'Homepage has no app entry bundle.');
  const bundle = await get(asset[1]);
  assert.equal(bundle.status, 200);
  assert.match(bundle.headers.get('content-type') || '', /javascript/);
  await bundle.body.cancel();
  const config = await get('/api/community/config');
  assert.equal(config.status, 200);
  if (!(await config.json()).enabled) return { daily: 'disabled' };
  const catalog = await get('/api/catalog?kind=official');
  assert.equal(catalog.status, 200);
  const page = await catalog.json();
  assert.ok(Array.isArray(page.items));
  assert.ok(page.items.length > 0, 'Public trips are enabled without an official fallback.');
  assert.ok(
    page.items.every(
      (p) => p.kind === 'official' && p.rounds > 0 && !p.photos && !p.ownerUid && !p.sourceGameId,
    ),
  );
  const before = now();
  const dailyResponse = await get('/api/daily');
  assert.equal(dailyResponse.status, 200);
  const daily = await dailyResponse.json();
  // A request crossing midnight may legitimately describe either adjacent day.
  const dates = [before, now()].map((time) => new Date(time).toISOString().slice(0, 10));
  assert.ok(dates.includes(daily.date), 'Daily API returned a stale or invalid date.');
  assert.equal(daily.resetsAt, Date.parse(`${daily.date}T00:00:00Z`) + 86400_000);
  if (daily.trip === null) return { daily: 'unavailable' };
  const trip = daily.trip;
  assert.ok(trip && trip.kind === 'daily', 'Daily challenge metadata is missing.');
  assert.equal(trip.id, `daily-${daily.date}`);
  assert.equal(trip.dailyDate, daily.date);
  assert.equal(trip.rounds, 5);
  assert.equal(trip.settings?.timeLimitSeconds, 60);
  assert.ok(
    !trip.photos && !trip.ownerUid && !trip.sourceGameId,
    'Daily API exposed private fields.',
  );
  return { daily: 'available' };
}

async function main(urls) {
  assert.ok(urls.length, 'Pass the origin and/or public URL.');
  for (const base of urls) {
    assert.equal(new URL(base).protocol, 'https:');
    let lastError;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const result = await checkRelease(base);
        if (result.daily === 'unavailable') {
          const message = `DEGRADED: daily challenge unavailable at ${new URL(base).hostname}; health, app bundle and official fallback passed.`;
          console.warn(process.env.GITHUB_ACTIONS ? `::warning::${message}` : message);
          if (process.env.GITHUB_STEP_SUMMARY)
            await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n${message}\n`);
        } else {
          console.log(
            `PASS: health, app bundle and enabled public APIs at ${new URL(base).hostname} (daily: ${result.daily})`,
          );
        }
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    if (lastError) throw lastError;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main(process.argv.slice(2));
