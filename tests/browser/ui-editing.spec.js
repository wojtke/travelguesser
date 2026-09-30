import { test, expect } from '@playwright/test';
import sharp from 'sharp';

test.beforeEach(async ({ context }) => {
  await context.route('https://tile.openstreetmap.org/**', (route) => route.abort());
});
async function signIn(page) {
  const session = await (await page.request.get('/api/session')).json();
  await page.request.post('/api/auth/session', {
    headers: { 'X-CSRF-Token': session.csrfToken },
    data: { idToken: 'local-development' },
  });
}
async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

test('My trips opens the editor; photos, order, locations and options save to the same link', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/');
  await page
    .locator('.trip-card')
    .filter({ hasText: 'editable-browser-trip' })
    .getByRole('button', { name: 'Edit trip', exact: true })
    .click();
  await expect(page).toHaveURL(/\/g\/editable-browser-trip\/edit$/);
  await expect(page.getByLabel('Trip name', { exact: true })).toHaveValue('editable-browser-trip');
  await page.getByLabel('Trip name', { exact: true }).fill('Edited browser trip');
  await page.getByRole('button', { name: 'Back to my trips', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await page.getByLabel('Caption', { exact: false }).fill('Updated first photo');
  if (!(await page.getByLabel('Latitude', { exact: true }).isVisible()))
    await page.locator('.coordinates summary').click();
  await page.getByLabel('Latitude', { exact: true }).fill('45');
  await page.getByLabel('Longitude', { exact: true }).fill('19');
  await page.getByRole('button', { name: 'Set pin', exact: true }).click();
  await page.getByRole('button', { name: 'Move later', exact: true }).click();
  await expect(page.getByLabel('Caption', { exact: false })).toHaveValue('Updated first photo');
  await page.getByRole('button', { name: '← Previous', exact: true }).click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  const buffer = await sharp({
    create: { width: 160, height: 120, channels: 3, background: '#836c44' },
  })
    .jpeg()
    .toBuffer();
  await page
    .getByLabel('Upload travel photos')
    .setInputFiles({ name: 'synthetic.jpg', mimeType: 'image/jpeg', buffer });
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Set locations');
  if (!(await page.getByLabel('Latitude', { exact: true }).isVisible()))
    await page.locator('.coordinates summary').click();
  await page.getByLabel('Latitude', { exact: true }).fill('-20');
  await page.getByLabel('Longitude', { exact: true }).fill('120');
  await page.getByRole('button', { name: 'Set pin', exact: true }).click();
  await page.getByLabel('Caption', { exact: false }).fill('Added photo');
  await page.getByRole('spinbutton', { name: 'Time per photo', exact: false }).fill('37');
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await page.screenshot({ path: test.info().outputPath('trip-editor-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Changes saved', exact: true })).toBeVisible();
  await expect(page.getByLabel('Trip invite link')).toHaveValue(/\/g\/editable-browser-trip$/);
  const saved = await (await page.request.get('/api/games/editable-browser-trip/edit')).json();
  expect(saved.title).toBe('Edited browser trip');
  expect(saved.settings.timeLimitSeconds).toBe(37);
  expect(saved.photos.map((p) => [p.caption, p.lat, p.lng])).toEqual([
    ['Updated first photo', 45, 19],
    ['Added photo', -20, 120],
  ]);
  await page.getByRole('button', { name: 'Back to my trips', exact: true }).click();
  await page
    .locator('.trip-card')
    .filter({ hasText: 'Edited browser trip' })
    .getByRole('button', { name: 'Edit trip', exact: true })
    .click();
  await expect(page.getByLabel('Trip name', { exact: true })).toHaveValue('Edited browser trip');
  await expect(page.locator('.photo-thumb')).toHaveCount(2);
});

test('public scores have padding and trip actions wrap within their cards on desktop and mobile', async ({
  page,
}) => {
  await signIn(page);
  await page.route('**/api/public-profile', (route) =>
    route.fulfill({
      json: {
        scores: [{ id: 'layout-public-trip', title: 'Daily challenge · 2026-09-30' }],
        cursor: null,
      },
    }),
  );
  await page.goto('/');
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const panel = page.locator('.my-public-scores');
    await panel.scrollIntoViewIfNeeded();
    const padding = await panel
      .locator('summary')
      .evaluate((el) => parseFloat(getComputedStyle(el).paddingTop));
    expect(padding).toBeGreaterThanOrEqual(16);
    await noOverflow(page);
    const bounds = await panel.boundingBox();
    const card = await page.locator('.trip-card').first().boundingBox();
    expect(card.y - (bounds.y + bounds.height)).toBeGreaterThanOrEqual(20);
    await page.screenshot({ path: test.info().outputPath(`my-trips-${width}.png`) });
  }
  await page.getByText('My public scores', { exact: false }).click();
  await expect(page.getByRole('link', { name: 'Daily challenge · 2026-09-30' })).toBeVisible();
});

test('public trip actions have space before explanatory text at each viewport size', async ({
  page,
}) => {
  const edition = (await (await page.request.get('/api/catalog?q=test')).json()).items[0];
  await page.goto(`/p/${edition.id}`);
  await expect(page.getByRole('button', { name: 'Play solo', exact: true })).toBeVisible();
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const actions = await page.locator('.public-trip-heading .center-buttons').boundingBox();
    const note = await page.locator('.public-trip-heading .small-note').boundingBox();
    expect(note.y - (actions.y + actions.height)).toBeGreaterThanOrEqual(16);
    await noOverflow(page);
    await page.screenshot({
      path: test.info().outputPath(`public-trip-${width}.png`),
      fullPage: true,
    });
  }
});

test('results group actions, align round maps and keep distant pins inside resized mini maps', async ({
  page,
}) => {
  const results = [
    {
      actual: { lat: 48.85, lng: 2.3 },
      guess: { lat: -75, lng: 179 },
      caption: 'A longer caption that wraps onto several lines for this photo.',
    },
    { actual: { lat: -33.8, lng: 151.2 }, guess: { lat: 85, lng: -150 }, caption: 'Short caption' },
    { actual: { lat: 37.8, lng: -122.5 }, guess: { lat: -40, lng: 170 }, caption: '' },
  ].map((r, round) => ({
    ...r,
    round,
    photoIndex: round,
    score: 1000,
    distance: 10000,
    durationMs: 6500,
    credit: {
      author: 'Test author',
      title: 'Synthetic credit',
      source: 'https://example.com/photo',
      license: 'CC0',
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    },
  }));
  await page.route('**/api/publications/layout-public-trip', (route) =>
    route.fulfill({
      json: {
        game: {
          id: 'layout-public-trip',
          title: 'Daily challenge · 2026-09-30',
          hostName: 'TripGuessr',
          rounds: 3,
          settings: { timeLimitSeconds: 60 },
        },
        run: {
          name: 'Player',
          publicId: 'synthetic-player',
          score: 3000,
          completed: true,
          ranked: true,
          results,
        },
      },
    }),
  );
  await page.route('**/api/publications/layout-public-trip/leaderboard', (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route('**/api/publications/layout-public-trip/photos/*', (route) =>
    route.fulfill({ path: 'server/demo/demo-paris.jpg', contentType: 'image/jpeg' }),
  );
  await page.goto('/p/layout-public-trip/play');
  await expect(page.getByRole('heading', { name: 'Results', exact: true })).toBeVisible();
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await noOverflow(page);
    await page.locator('.results-hero').scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath(`results-actions-${width}.png`) });
    const status = await page.locator('.result-rank-status').boundingBox();
    const actions = await page.locator('.result-play-actions').boundingBox();
    expect(actions.y - (status.y + status.height)).toBeGreaterThanOrEqual(16);
    for (const map of await page.locator('.result-mini').all()) {
      await map.scrollIntoViewIfNeeded();
      await expect(map.locator('.map-marker.actual')).toBeVisible();
      await expect
        .poll(async () =>
          map.locator('.mini-map').evaluate((el) => {
            const bounds = el.getBoundingClientRect();
            return [...el.querySelectorAll('.map-marker-container')].every((marker) => {
              const box = marker.getBoundingClientRect();
              return (
                box.left >= bounds.left &&
                box.right <= bounds.right &&
                box.top >= bounds.top &&
                box.bottom <= bounds.bottom
              );
            });
          }),
        )
        .toBe(true);
    }
    if (width === 1440) {
      const positions = await page
        .locator('.mini-map')
        .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));
      expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(2);
    }
    await page.screenshot({
      path: test.info().outputPath(`round-cards-${width}.png`),
      fullPage: true,
    });
  }
  await page.getByRole('button', { name: 'Expand map', exact: true }).first().click();
  await expect(page.locator('.result-mini.expanded .leaflet-control-zoom')).toBeVisible();
});
