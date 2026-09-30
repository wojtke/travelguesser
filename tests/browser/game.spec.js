import { test, expect } from '@playwright/test';
// Tests use synthetic local data and never consume the public map service.
test.beforeEach(async ({ context }) => {
  await context.route('https://tile.openstreetmap.org/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC9sAAAAASUVORK5CYII=',
        'base64',
      ),
    }),
  );
});

test('mobile photo stays clear until map is opened, and a pin survives closing it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/g/demo-trip');
  await page.getByLabel('Your name', { exact: true }).fill('Mobile player');
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('.photo-canvas img')).toBeVisible();
  const toggle = page.getByRole('button', { name: 'Open map', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#play-map-panel')).toBeHidden();
  await toggle.click();
  await expect(page.getByRole('button', { name: 'Back to photo', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await page.locator('.guess-map').click({ position: { x: 100, y: 100 } });
  await expect(page.getByRole('button', { name: /Confirm guess/ })).toBeEnabled();
  await page.getByRole('button', { name: 'Back to photo', exact: true }).click();
  await page.getByRole('button', { name: 'Map · pin set', exact: true }).click();
  await expect(page.getByRole('button', { name: /Confirm guess/ })).toBeEnabled();
});

test('space confirms a guess and the next solo round expires on the server', async ({ page }) => {
  await page.goto('/g/timed-browser-trip');
  await page.getByLabel('Your name', { exact: true }).fill('Timed player');
  await page.getByRole('button', { name: 'Start game' }).click();
  await page.locator('.guess-map').click({ position: { x: 100, y: 100 } });
  await page.locator('.photo-viewport').focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('heading', { name: 'Location revealed' })).toBeVisible();
  await page.getByRole('button', { name: 'Next photo' }).click();
  await expect(page.getByRole('heading', { name: 'Where was this photo taken?' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Location revealed' })).toBeVisible({
    timeout: 20000,
  });
  await expect(page.locator('.result-numbers')).toContainText('No guess');
  await page.getByRole('button', { name: 'See results' }).click();
  await expect(page.getByRole('heading', { name: 'Results', exact: true })).toBeVisible();
});

test('two browsers reveal live results together and a removed player loses access', async ({
  browser,
  page: host,
}) => {
  const session = await (await host.request.get('/api/session')).json();
  await host.request.post('/api/auth/session', {
    headers: { 'X-CSRF-Token': session.csrfToken },
    data: { idToken: 'local-development' },
  });
  const { game } = await (await host.request.get('/api/games/live-browser-trip')).json();
  const url = `/g/${game.id}/live/${game.liveId}`;
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    const players = await Promise.all(contexts.map((c) => c.newPage()));
    for (const [i, p] of players.entries()) {
      await p.route('https://tile.openstreetmap.org/**', (r) => r.abort());
      await p.goto(url);
      await p.getByLabel('Your nickname').fill(`Player ${i}`);
      await p.getByRole('button', { name: 'Join lobby' }).click();
      await expect(p.getByText('You’re in.', { exact: false })).toBeVisible();
    }
    await host.goto(url);
    await host.getByRole('button', { name: 'Start first round' }).click();
    for (const p of players)
      await expect(p.getByRole('heading', { name: 'Round 1 / 2' })).toBeVisible();
    await expect(players[0].locator('.round-preparation')).toHaveCount(0, { timeout: 8000 });
    await players[0].locator('.guess-map').click({ position: { x: 100, y: 100 } });
    await players[0].getByRole('button', { name: /Confirm guess/ }).click();
    await expect(players[0].getByText('Guess confirmed. Waiting for the group.')).toBeVisible();
    await expect(players[1].getByRole('heading', { name: 'Round 1 / 2' })).toBeVisible();
    await players[1].locator('.guess-map').click({ position: { x: 100, y: 100 } });
    await players[1].getByRole('button', { name: /Confirm guess/ }).click();
    for (const p of [host, ...players])
      await expect(p.getByRole('heading', { name: 'This round', exact: true })).toBeVisible();
    await host.getByRole('button', { name: 'Start next round' }).click();
    await host.getByText('Host controls', { exact: true }).click();
    await host
      .locator('.lobby-players li')
      .filter({ hasText: 'Player 1' })
      .getByRole('button', { name: 'Remove', exact: true })
      .click();
    await expect(
      players[1].getByRole('heading', { name: 'You are no longer in this lobby' }),
    ).toBeVisible();
    const photo = await players[1].request.get(
      `/api/games/${game.id}/live/${game.liveId}/photos/1`,
    );
    expect(photo.status()).toBe(403);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});

test('the lazy-loaded creator page still uploads a trip with a manually chosen location', async ({
  page,
}) => {
  const { default: sharp } = await import('sharp');
  const buffer = await sharp({
    create: { width: 100, height: 80, channels: 3, background: '#609040' },
  })
    .jpeg()
    .toBuffer();
  await page.goto('/');
  await page.getByRole('button', { name: 'Create a trip', exact: true }).first().click();
  await page.getByRole('button', { name: 'Continue locally' }).click();
  await page.getByLabel('Trip name', { exact: true }).fill('Browser upload');
  await page
    .getByLabel('Upload travel photos')
    .setInputFiles({ name: 'synthetic.jpg', mimeType: 'image/jpeg', buffer });
  await page.getByText('Or enter coordinates', { exact: false }).click();
  await page.getByLabel('Latitude', { exact: true }).fill('0');
  await page.getByLabel('Longitude', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Set pin', exact: true }).click();
  await page.getByRole('button', { name: 'Create & share trip' }).click();
  await expect(page.getByRole('heading', { name: 'Trip created' })).toBeVisible();
});

test('creation highlights incomplete photos, preserves edits on Next and accepts custom timer seconds', async ({
  page,
}) => {
  const session = await (await page.request.get('/api/session')).json();
  await page.request.post('/api/auth/session', {
    headers: { 'X-CSRF-Token': session.csrfToken },
    data: { idToken: 'local-development' },
  });
  await page.goto('/create');
  await expect(page.getByLabel('Trip name', { exact: true })).toHaveValue(/.+’s trip #\d+/);
  await page.getByRole('button', { name: 'Create & share trip' }).click();
  await expect(page.getByRole('alert')).toContainText('Add at least one photo');
  const { default: sharp } = await import('sharp'),
    buffer = await sharp({ create: { width: 80, height: 60, channels: 3, background: '#73885a' } })
      .jpeg()
      .toBuffer();
  await page
    .getByLabel('Upload travel photos')
    .setInputFiles([1, 2].map((i) => ({ name: `image${i}.jpg`, mimeType: 'image/jpeg', buffer })));
  await page.getByRole('button', { name: 'Create & share trip' }).click();
  await expect(page.locator('.photo-thumb.needs-location')).toHaveCount(2);
  await expect(page.locator('.location-editor')).toBeFocused();
  await page.getByLabel('Caption', { exact: false }).fill('First caption');
  await page.getByRole('button', { name: 'Next →', exact: true }).click();
  await expect(page.getByLabel('Caption', { exact: false })).toHaveValue('');
  await page.getByRole('button', { name: '← Previous', exact: true }).click();
  await expect(page.getByLabel('Caption', { exact: false })).toHaveValue('First caption');
  const photoBox = await page.locator('.photo-workspace').boundingBox(),
    details = await page.locator('.trip-details').boundingBox();
  expect(details.y).toBeGreaterThan(photoBox.y + photoBox.height - 1);
  await page.getByRole('combobox', { name: 'Round timer', exact: true }).selectOption('fixed');
  await page.getByRole('spinbutton', { name: 'Time per photo', exact: false }).fill('7');
  await expect(page.getByRole('slider', { name: 'Time per photo slider' })).toHaveValue('7');
  await page.getByRole('spinbutton', { name: 'Time per photo', exact: false }).fill('3601');
  await page.getByRole('button', { name: 'Create & share trip' }).click();
  await expect(page.getByRole('alert')).toContainText('1 to 3600');
  await page.getByRole('spinbutton', { name: 'Time per photo', exact: false }).fill('3600');
  await expect(page.getByRole('slider', { name: 'Time per photo slider' })).toHaveValue('3600');
  await page.screenshot({ path: test.info().outputPath('creation.png'), fullPage: true });
});

test('shared result links clearly identify results and reveal no photos or locations', async ({
  page,
}) => {
  await page.goto('/g/demo-trip');
  await page.getByLabel('Your name', { exact: true }).fill('Sharing player');
  await page.getByRole('button', { name: 'Start game' }).click();
  for (let i = 0; i < 3; i++) {
    await page.locator('.guess-map').click({ position: { x: 110, y: 100 } });
    await page.getByRole('button', { name: /Confirm guess/ }).click();
    await page.getByRole('button', { name: i === 2 ? 'See results' : 'Next photo' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Round results', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Round-by-round scores' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Invite to trip', exact: true })).toBeVisible();
  await page.locator('.result-mini').first().scrollIntoViewIfNeeded();
  await expect(page.locator('.mini-map .map-marker.actual').first()).toBeVisible();
  await page.getByRole('button', { name: 'Expand map', exact: true }).first().click();
  await expect(page.locator('.result-mini.expanded .leaflet-control-zoom')).toBeVisible();
  await page.getByRole('button', { name: 'Collapse map', exact: true }).click();
  await page.screenshot({ path: test.info().outputPath('results.png'), fullPage: true });
  await page.getByRole('button', { name: 'Share my results', exact: true }).click();
  const field = page.getByLabel('Your results link');
  await expect(field).toBeVisible();
  const url = await field.inputValue();
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'Sharing player’s results' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play this trip' })).toBeVisible();
  await expect(page.locator('.leaflet-container')).toHaveCount(0);
  await expect(page.locator('main img')).toHaveCount(0);
});

test('slow photos do not hold everyone up; first-lock timeout scores a saved pin without confirmation', async ({
  browser,
  page: host,
}) => {
  const session = await (await host.request.get('/api/session')).json();
  const headers = { 'X-CSRF-Token': session.csrfToken };
  await host.request.post('/api/auth/session', { headers, data: { idToken: 'local-development' } });
  const existing = await (await host.request.get('/api/games/live-browser-trip')).json();
  await host.request.post(`/api/games/live-browser-trip/live/${existing.game.liveId}/end`, {
    headers,
    data: {},
  });
  const live = await (
    await host.request.post('/api/games/live-browser-trip/live', {
      headers,
      data: {
        timerMode: 'afterFirstLock',
        afterFirstLockSeconds: 5,
        nextRoundControl: 'anyPlayer',
      },
    })
  ).json();
  const url = `/g/live-browser-trip/live/${live.id}`,
    contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    const [a, b] = await Promise.all(contexts.map((c) => c.newPage()));
    for (const [i, p] of [a, b].entries()) {
      await p.route('https://tile.openstreetmap.org/**', (r) => r.abort());
      if (i === 1)
        await p.route('**/live/*/photos/0', async (r) => {
          await new Promise((resolve) => setTimeout(resolve, 6800));
          await r.continue();
        });
      await p.goto(url);
      await p.getByLabel('Your nickname').fill(`Timing ${i}`);
      await p.getByRole('button', { name: 'Join lobby' }).click();
    }
    await host.goto(url);
    await expect(host.getByRole('radio', { name: /Host only/ })).toBeChecked();
    await host.getByRole('button', { name: 'Start first round' }).click();
    await expect(host.locator('.round-preparation')).toBeVisible();
    await expect(a.locator('.round-preparation')).toBeVisible();
    await expect(a.locator('.round-preparation')).toHaveCount(0, { timeout: 8000 });
    await expect(b.locator('.round-preparation')).toContainText('Photo is loading');
    await a.locator('.guess-map').click({ position: { x: 130, y: 100 } });
    await a.getByRole('button', { name: /Confirm guess/ }).click();
    await expect(b.locator('.round-preparation')).toHaveCount(0, { timeout: 5000 });
    await b.locator('.guess-map').click({ position: { x: 130, y: 100 } });
    await expect(b.getByText('Saved · This pin counts at timeout.', { exact: true })).toBeVisible();
    await expect(b.getByRole('timer')).toHaveClass(/critical/);
    await b.getByRole('button', { name: 'Mute countdown sound' }).click();
    await expect(b.getByRole('button', { name: 'Enable countdown sound' })).toBeVisible();
    await expect(b.getByRole('heading', { name: 'This round', exact: true })).toBeVisible({
      timeout: 8000,
    });
    await expect(b.locator('.my-score').first()).not.toContainText('No guess');
    await expect(b.getByText('Timing 1 (You)', { exact: false }).first()).toBeVisible();
    await b.screenshot({ path: test.info().outputPath('live-results.png'), fullPage: true });
    await b.getByRole('button', { name: 'Start next round' }).click();
    await expect(host.getByRole('heading', { name: 'Round 2 / 2' })).toBeVisible();
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});

test('public search, ranked consent, results, replay and withdrawal work end to end', async ({
  page,
}) => {
  const session = await (await page.request.get('/api/session')).json();
  await page.request.post('/api/auth/session', {
    headers: { 'X-CSRF-Token': session.csrfToken },
    data: { idToken: 'local-development' },
  });
  await page.goto('/explore');
  await page.getByLabel('Search titles and tags').fill('test');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('link', { name: 'Public browser trip' }).click();
  await page.getByRole('button', { name: 'Play solo' }).click();
  const consent = page.getByRole('checkbox', { name: /Count my first attempt/ });
  await expect(consent).not.toBeChecked();
  await consent.check();
  await page.getByLabel('Your name', { exact: true }).fill('Public test player');
  await page.getByRole('button', { name: 'Start ranked attempt' }).click();
  await expect(page.locator('.photo-canvas img')).toBeVisible();
  await page.locator('.guess-map').click({ position: { x: 100, y: 100 } });
  await page.getByRole('button', { name: /Confirm guess/ }).click();
  await page.getByRole('button', { name: 'See results' }).click();
  await expect(page.locator('.scores-table').first()).toContainText('Public test player');
  await expect(
    page.locator('.scores-table').first().locator('tbody tr').first().locator('td').first(),
  ).toContainText('1');
  await page.screenshot({
    path: test.info().outputPath('public-ranked-results.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: /Remove my public score/ }).click();
  await expect(page.locator('.scores-table').first()).not.toContainText('Public test player');
  await page.getByRole('button', { name: /Play again for practice/ }).click();
  await expect(page.locator('.photo-canvas img')).toBeVisible();
});

test('a report returns a working private receipt and a public room can be hosted independently', async ({
  page,
}) => {
  const session = await (await page.request.get('/api/session')).json();
  await page.request.post('/api/auth/session', {
    headers: { 'X-CSRF-Token': session.csrfToken },
    data: { idToken: 'local-development' },
  });
  const p = (await (await page.request.get('/api/catalog?q=test')).json()).items[0];
  await page.goto(`/p/${p.id}`);
  await page.getByRole('button', { name: 'Play with friends' }).click();
  await page.getByLabel('Your host nickname').fill('Friend host');
  await page.getByRole('button', { name: 'Create private room' }).click();
  await expect(page.getByRole('button', { name: 'Start first round' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Host only/ })).toBeChecked();
  await page.getByRole('button', { name: 'Close lobby' }).click();
  await expect(page.getByRole('heading', { name: p.title, exact: true })).toBeVisible();
  await page.goto(`/contact?target=${encodeURIComponent(`/p/${p.id}`)}`);
  await page.getByLabel('Describe the issue').fill('Synthetic browser test report.');
  await page.getByRole('checkbox', { name: /This report is accurate/ }).check();
  await page.getByRole('button', { name: 'Send and get private receipt' }).click();
  await expect(page.getByRole('heading', { name: 'Private report receipt' })).toBeVisible();
  await expect(page.locator('.report-thread')).toContainText('Synthetic browser test report.');
  await page.getByLabel('Reply or request review').fill('Additional test details.');
  await page.getByRole('button', { name: 'Send reply', exact: true }).click();
  await expect(page.locator('.report-thread')).toContainText('Additional test details.');
  const link = await page.getByLabel('Private receipt link').inputValue();
  expect(link).toContain('#');
  await page.reload();
  await expect(page.locator('.report-thread')).toContainText('Additional test details.');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/explore');
  await expect(page.getByRole('link', { name: 'Public browser trip' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('mobile-explore.png'), fullPage: true });
});
