import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { testAuthentication } from './helpers.js';
import { errorDetails, routeName } from '../server/observability.js';

test('request telemetry never records private links, inputs, identity or browser headers', async () => {
  const logs = [],
    secret = 'sensitive-personal-value',
    trip = 'privateTripLink123456789';
  const app = createApp({
    auth: testAuthentication(),
    rateLimits: false,
    log: (entry) => logs.push(entry),
    store: { getGame: async () => null },
  });
  await request(app)
    .get(`/api/games/${trip}?email=${secret}`)
    .set('Cookie', `tg_creator=${secret}`)
    .set('X-Forwarded-For', '192.0.2.10')
    .set('Referer', `https://example.test/${secret}`)
    .set('User-Agent', secret)
    .expect(404);
  await request(app)
    .post('/api/games/demo-trip/join')
    .send({ name: secret, lat: 48.123456 })
    .expect(500);
  await request(app)
    .post(`/api/${secret}`)
    .set('Content-Type', 'application/json')
    .send(`{"secret":"${secret}"`)
    .expect(400);
  assert.equal(logs.length, 3);
  assert.equal(logs[0].route, '/api/games/:trip');
  assert.equal(logs[1].severity, 'ERROR');
  assert.equal(logs[1].errorType, 'TypeError');
  assert.equal(logs[2].route, 'other');
  const serialized = JSON.stringify(logs);
  for (const value of [secret, trip, '192.0.2.10', '48.123456', 'Cookie', 'Referer', 'User-Agent'])
    assert.ok(!serialized.includes(value));
});

test('error diagnostics strip messages, causes, and injected multiline message content', () => {
  const secret = 'private@example.test';
  const err = new Error(`${secret}\n    at /server/private.js:1:1`, { cause: { email: secret } });
  err.stack += '\n    at unsafeFunctionName (file:///app/server/app.js:12:34)';
  const safe = errorDetails(err);
  assert.ok(!JSON.stringify(safe).includes(secret));
  assert.ok(!JSON.stringify(safe).includes('private.js'));
  assert.ok(!JSON.stringify(safe).includes('unsafeFunctionName'));
  assert.ok(safe.frames.includes('server/app.js:12:34'));
});

test('known app pages work while bot probes and missing assets return 404', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tripguessr-routing-'));
  try {
    await writeFile(path.join(directory, 'index.html'), '<!doctype html><title>TripGuessr</title>');
    const logs = [],
      app = createApp({
        auth: testAuthentication(),
        rateLimits: false,
        distDirectory: directory,
        log: (entry) => logs.push(entry),
      });
    for (const url of [
      '/',
      '/privacy',
      '/create',
      '/g/demo-trip',
      '/g/privateTrip123/live/privateLobby123',
    ])
      await request(app).get(url).expect(200);
    for (const url of ['/wp-login.php', '/.env', '/assets/missing.js', '/random-private-path'])
      await request(app).get(url).expect(404);
    assert.equal(logs.length, 9);
    assert.ok(!JSON.stringify(logs).includes('random-private-path'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('activity counters count successful operations without claiming unique people', async () => {
  const logs = [],
    app = createApp({
      auth: testAuthentication(),
      rateLimits: false,
      log: (entry) => logs.push(entry),
    });
  await request(app).get('/api/session').expect(200);
  await request(app).get('/api/session').expect(200);
  await request(app).post('/api/games').expect(401);
  assert.deepEqual(
    logs.map((e) => e.activity),
    ['app_initializations', 'app_initializations', undefined],
  );
  assert.equal(routeName('/api/games/private/live/private/untrusted-action'), 'other');
});
