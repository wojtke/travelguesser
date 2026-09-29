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
      console.log(`PASS: health, homepage and app bundle at ${new URL(base).hostname}`);
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  if (lastError) throw lastError;
}
