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
    await players[0].locator('.guess-map').click({ position: { x: 100, y: 100 } });
    await players[0].getByRole('button', { name: /Confirm guess/ }).click();
    await expect(players[0].getByText('Guess confirmed. Waiting for the group.')).toBeVisible();
    await expect(players[1].getByRole('heading', { name: 'Round 1 / 2' })).toBeVisible();
    await players[1].locator('.guess-map').click({ position: { x: 100, y: 100 } });
    await players[1].getByRole('button', { name: /Confirm guess/ }).click();
    for (const p of [host, ...players])
      await expect(p.getByRole('heading', { name: 'Everyone’s guesses' })).toBeVisible();
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
