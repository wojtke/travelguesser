const APP_ORIGIN = 'https://travelguesser-253699422366.europe-central2.run.app';
const AUTH_ORIGIN = 'https://travelguesser-woj-20260926.firebaseapp.com';
const DOMAIN = 'tripguessr.com';

// Keep the application and its cookies on the public domain. Only these two
// fixed Google origins can receive requests; this is not an open proxy.
export async function proxyRequest(request, fetchUpstream = fetch) {
  const url = new URL(request.url);
  if (![DOMAIN, `www.${DOMAIN}`].includes(url.hostname)) {
    return new Response('Not found', { status: 404 });
  }
  if (url.hostname !== DOMAIN || url.protocol !== 'https:') {
    url.protocol = 'https:';
    url.host = DOMAIN;
    return Response.redirect(url.href, 308);
  }
  const auth = url.pathname.startsWith('/__/auth/') || url.pathname === '/__/firebase/init.json';
  const origin = request.headers.get('Origin');
  if (!auth && !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      ((origin && origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site')) {
    return Response.json({ error: 'Please open the app directly to continue.' }, { status: 403 });
  }
  const upstreamOrigin = auth ? AUTH_ORIGIN : APP_ORIGIN;
  const upstream = new URL(url);
  upstream.host = new URL(upstreamOrigin).host;
  const headers = new Headers(request.headers);
  headers.delete('Host');
  headers.delete('X-Forwarded-Host');
  headers.set('X-Forwarded-Proto', 'https');
  if (!auth && origin === url.origin) headers.set('Origin', APP_ORIGIN);
  if (auth) {
    headers.delete('Cookie');
    headers.delete('Authorization');
  }
  const forwarded = new Request(upstream, request);
  const response = await fetchUpstream(new Request(forwarded, { headers, redirect: 'manual' }));
  const location = response.headers.get('Location');
  if (location) {
    const target = new URL(location, upstream);
    if (target.origin === upstreamOrigin) {
      target.host = DOMAIN;
      const redirected = new Response(response.body, response);
      redirected.headers.set('Location', target.href);
      return redirected;
    }
  }
  return response;
}

export default { fetch(request) { return proxyRequest(request); } };
