import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRelease } from '../scripts/check-release.mjs';

const date = '2026-09-30',
  now = () => Date.parse(`${date}T12:00:00Z`);
const valid = () => ({
  date,
  resetsAt: Date.parse('2026-10-01T00:00:00Z'),
  trip: {
    id: `daily-${date}`,
    dailyDate: date,
    kind: 'daily',
    rounds: 5,
    settings: { timeLimitSeconds: 60 },
  },
});
async function check(daily, items = [{ kind: 'official', rounds: 5 }]) {
  return checkRelease('https://release.example', {
    now,
    fetchImpl: async (url) => {
      const path = new URL(url).pathname;
      if (path === '/') return new Response('<script src="/assets/app.js"></script>');
      if (path.startsWith('/assets/'))
        return new Response('// bundle', { headers: { 'Content-Type': 'application/javascript' } });
      return Response.json(
        {
          '/api/health': { status: 'ok' },
          '/api/community/config': { enabled: true },
          '/api/catalog': { items },
          '/api/daily': daily,
        }[path],
      );
    },
  });
}
test('release checks validate daily metadata and distinguish the permitted fallback', async () => {
  assert.deepEqual(await check(valid()), { daily: 'available' });
  assert.deepEqual(await check({ ...valid(), trip: null }), { daily: 'unavailable' });
  await assert.rejects(check({ ...valid(), trip: null }, []), /official fallback/);
});
test('release checks reject missing, stale, malformed or answer-leaking daily data', async () => {
  for (const daily of [
    { ...valid(), trip: undefined },
    { ...valid(), date: '2026-09-29' },
    { ...valid(), resetsAt: 0 },
    { ...valid(), trip: { ...valid().trip, rounds: 4 } },
    { ...valid(), trip: { ...valid().trip, settings: { timeLimitSeconds: 30 } } },
    { ...valid(), trip: { ...valid().trip, photos: [{ lat: 0, lng: 0 }] } },
  ])
    await assert.rejects(check(daily));
});
