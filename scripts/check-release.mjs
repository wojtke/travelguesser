// Read-only post-deployment checks. No gameplay records, cookies or analytics identities.
import assert from 'node:assert/strict';
const urls = process.argv.slice(2);
assert.ok(urls.length, 'Pass the origin and/or public URL.');
for (const base of urls) {
  assert.equal(new URL(base).protocol, 'https:');
  let lastError;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(10000) });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).status, 'ok');
      const home = await fetch(`${base}/`, { signal: AbortSignal.timeout(10000) });
      assert.equal(home.status, 200);
      const html = await home.text();
      const asset = html.match(/src="(\/assets\/[^"<>]+\.js)"/);
      assert.ok(asset, 'Homepage has no app entry bundle.');
      const bundle = await fetch(new URL(asset[1], base), { signal: AbortSignal.timeout(10000) });
      assert.equal(bundle.status, 200);
      assert.match(bundle.headers.get('content-type') || '', /javascript/);
      await bundle.body.cancel();
      const config = await fetch(`${base}/api/community/config`, {
        signal: AbortSignal.timeout(10000),
      });
      assert.equal(config.status, 200);
      if ((await config.json()).enabled) {
        const catalog = await fetch(`${base}/api/catalog?kind=official`, {
          signal: AbortSignal.timeout(10000),
        });
        assert.equal(catalog.status, 200);
        const page = await catalog.json();
        assert.ok(Array.isArray(page.items));
        assert.ok(page.items.length > 0, 'Public trips are enabled without an official fallback.');
        assert.ok(page.items.every((p) => !p.photos && !p.ownerUid && !p.sourceGameId));
        const daily = await fetch(`${base}/api/daily`, { signal: AbortSignal.timeout(10000) });
        assert.equal(daily.status, 200);
        assert.match((await daily.json()).date, /^\d{4}-\d{2}-\d{2}$/);
      }
      console.log(`PASS: health, app bundle and enabled public APIs at ${new URL(base).hostname}`);
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  if (lastError) throw lastError;
}
