import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createLocationSearch, normalizePlaces } from '../server/location-search.js';
import { createApp } from '../server/app.js';
import { signIn, testAuthentication } from './helpers.js';

const feature = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [2.2945, 48.8584] },
  properties: {
    osm_type: 'W',
    osm_id: 123,
    name: 'Eiffel Tower',
    city: 'Paris',
    country: 'France',
    extent: [2.29, 48.86, 2.3, 48.85],
  },
};
const response = () => ({ ok: true, json: async () => ({ features: [feature] }) });

test('search converts provider coordinates and bounds and rejects malformed points', () => {
  const places = normalizePlaces({
    features: [
      feature,
      feature,
      { ...feature, geometry: { type: 'Point', coordinates: [0, 999] } },
      {
        ...feature,
        properties: { osm_id: 2, name: 'Zero' },
        geometry: { type: 'Point', coordinates: [0, 0] },
      },
    ],
  });
  assert.equal(places.length, 2);
  assert.equal(places[0].lat, 48.8584);
  assert.equal(places[0].lng, 2.2945);
  assert.deepEqual(places[0].bounds, [
    [48.85, 2.29],
    [48.86, 2.3],
  ]);
  assert.equal(places[0].details, 'Paris, France');
  assert.equal(places[1].lat, 0);
  assert.deepEqual(normalizePlaces({ features: [] }), []);
});

test('repeated and concurrent searches share a cached provider response', async () => {
  let calls = 0;
  const search = createLocationSearch({
    intervalMs: 0,
    fetchImpl: async (url) => {
      calls++;
      assert.equal(url.searchParams.get('q'), 'Eiffel Tower');
      return response();
    },
  });
  const [a, b] = await Promise.all([search(' Eiffel   Tower '), search('eiffel tower')]);
  assert.deepEqual(a, b);
  await search('EIFFEL TOWER');
  assert.equal(calls, 1);
});

test('invalid queries never reach the geocoder, and failures return a useful error', async () => {
  let calls = 0;
  const search = createLocationSearch({
    intervalMs: 0,
    fetchImpl: async () => {
      calls++;
      throw new Error('Internal provider failure');
    },
  });
  for (const query of [undefined, [], 1, '', 'a', 'x'.repeat(161)])
    await assert.rejects(search(query), { status: 400 });
  assert.equal(calls, 0);
  await assert.rejects(
    search('Paris'),
    (error) =>
      error.status === 502 &&
      error.message.includes('place a pin') &&
      !error.message.includes('Internal'),
  );
  assert.equal(calls, 1);
});

test('location search is restricted to hosts and passes results through the API', async () => {
  const search = createLocationSearch({ intervalMs: 0, fetchImpl: async () => response() });
  const app = createApp({ auth: testAuthentication(), rateLimits: false, searchLocations: search });
  await request(app).post('/api/host/locations/search').send({ query: 'Paris' }).expect(401);
  const host = request.agent(app);
  await signIn(host);
  await host.post('/api/host/locations/search').send({ query: 'x' }).expect(400);
  const result = await host
    .post('/api/host/locations/search')
    .send({ query: 'Eiffel Tower' })
    .expect(200);
  assert.equal(result.body.places[0].name, 'Eiffel Tower');
  assert.equal(result.body.places[0].lat, 48.8584);
  assert.equal(result.headers['cache-control'], 'no-store');
});
