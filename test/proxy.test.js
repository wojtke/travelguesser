import test from 'node:test';
import assert from 'node:assert/strict';
import { proxyRequest } from '../cloudflare/worker.js';

test('domain proxy streams API requests and preserves sessions and CSRF checks', async () => {
  const request = new Request('https://tripguessr.com/api/games/demo-trip/guess?round=1', {
    method: 'POST',
    body: '{"lat":12,"lng":34}',
    headers: {
      Origin: 'https://tripguessr.com',
      Cookie: 'tg_player=player; tg_csrf=csrf',
      'X-CSRF-Token': 'csrf',
      'X-Forwarded-Host': 'attacker.example',
    },
  });
  const response = await proxyRequest(request, async (upstream) => {
    assert.equal(
      upstream.url,
      'https://travelguesser-253699422366.europe-central2.run.app/api/games/demo-trip/guess?round=1',
    );
    assert.equal(
      upstream.headers.get('Origin'),
      'https://travelguesser-253699422366.europe-central2.run.app',
    );
    assert.equal(upstream.headers.get('Cookie'), 'tg_player=player; tg_csrf=csrf');
    assert.equal(upstream.headers.get('X-CSRF-Token'), 'csrf');
    assert.equal(upstream.headers.get('X-Forwarded-Host'), null);
    assert.equal(await upstream.text(), '{"lat":12,"lng":34}');
    return new Response('ok', {
      headers: {
        'Set-Cookie': 'tg_creator=session; Secure; HttpOnly',
        'Cache-Control': 'no-store',
      },
    });
  });
  assert.match(response.headers.get('Set-Cookie'), /tg_creator=session/);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('proxy refuses cross-site writes and unrelated hosts without contacting an origin', async () => {
  const unexpected = () => assert.fail('Upstream must not be contacted');
  assert.equal(
    (await proxyRequest(new Request('https://attacker.example/'), unexpected)).status,
    404,
  );
  for (const headers of [
    { Origin: 'https://attacker.example' },
    { 'Sec-Fetch-Site': 'cross-site' },
  ]) {
    assert.equal(
      (
        await proxyRequest(
          new Request('https://tripguessr.com/api/games', { method: 'POST', headers }),
          unexpected,
        )
      ).status,
      403,
    );
  }
});

test('canonical redirects preserve trip links and cannot become open redirects', async () => {
  const response = await proxyRequest(
    new Request('http://www.tripguessr.com//attacker.example/g/demo-trip?x=1'),
  );
  assert.equal(response.status, 308);
  assert.equal(
    response.headers.get('Location'),
    'https://tripguessr.com//attacker.example/g/demo-trip?x=1',
  );
});

test('custom Google auth handler reaches Firebase without forwarding app credentials', async () => {
  await proxyRequest(
    new Request('https://tripguessr.com/__/auth/handler?state=example', {
      headers: { Cookie: 'tg_creator=private-session', Authorization: 'Bearer private-token' },
    }),
    async (upstream) => {
      assert.equal(
        upstream.url,
        'https://travelguesser-woj-20260926.firebaseapp.com/__/auth/handler?state=example',
      );
      assert.equal(upstream.headers.get('Cookie'), null);
      assert.equal(upstream.headers.get('Authorization'), null);
      return new Response('handler');
    },
  );
});
