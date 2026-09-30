import { test, expect } from '@playwright/test';

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
async function edition(page, query = 'test') {
  return (await (await page.request.get(`/api/catalog?q=${query}`)).json()).items[0];
}

test('practice explains the first-attempt consequence for guests and signed-in players', async ({
  page,
}) => {
  const p = await edition(page, 'practice');
  await page.goto(`/p/${p.id}/play`);
  await expect(
    page.getByText(/Starting guest practice uses the first attempt in this browser/),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start practice', exact: true })).toBeVisible();
  await signIn(page);
  await page.reload();
  await expect(page.getByRole('checkbox', { name: /Count my first attempt/ })).not.toBeChecked();
  await expect(page.getByText(/Starting practice uses your first attempt/)).toBeVisible();
  await page.getByLabel('Your name', { exact: true }).fill('Practice player');
  await page.getByRole('button', { name: 'Start practice', exact: true }).click();
  await expect(page.locator('.photo-canvas img')).toBeVisible();
  const state = await (await page.request.get(`/api/publications/${p.id}`)).json();
  expect(state.run.ranked).toBe(false);
  expect(state.game.canRank).toBe(false);
});

test('a host can resume and cancel an empty room, then guess with the keyboard and end a live round', async ({
  page,
  browser,
}) => {
  await signIn(page);
  const p = await edition(page);
  const createRoom = async () => {
    await page.getByRole('button', { name: 'Play with friends', exact: true }).click();
    await page.getByLabel('Your host nickname').fill('Keyboard host');
    await page.getByRole('button', { name: 'Create private room' }).click();
  };
  await page.goto(`/p/${p.id}`);
  await createRoom();
  await expect(page.getByRole('button', { name: /Start first round/ })).toBeDisabled();
  const firstRoom = page.url();
  await page.getByRole('button', { name: 'Back to trip', exact: true }).click();
  await createRoom();
  await expect(page.getByRole('alert')).toContainText('End your existing room');
  await page.getByRole('button', { name: 'Open existing lobby' }).click();
  await expect(page).toHaveURL(firstRoom);
  await page.getByRole('button', { name: 'Close lobby' }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${p.id}$`));
  await createRoom();
  await expect(page.getByRole('button', { name: /Start first round/ })).toBeVisible();
  expect(page.url()).not.toBe(firstRoom);
  await page.getByRole('radio', { name: /Host and play/ }).click();
  await expect(page.getByRole('radio', { name: /Host and play/ })).toBeChecked();
  const liveId = new URL(page.url()).pathname.split('/').at(-1);
  const guest = await browser.newContext();
  try {
    const session = await (await guest.request.get('http://127.0.0.1:4179/api/session')).json();
    await guest.request.post(`http://127.0.0.1:4179/api/publications/${p.id}/live/${liveId}/join`, {
      headers: { 'X-CSRF-Token': session.csrfToken },
      data: { name: 'Waiting guest' },
    });
    await page.getByRole('button', { name: /Start first round/ }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.round-preparation')).toHaveCount(0, { timeout: 8000 });
    await page.getByRole('button', { name: 'Open map', exact: true }).press('Enter');
    await page.locator('.coordinates summary').press('Enter');
    await page.getByLabel('Latitude', { exact: true }).press('0');
    await page.getByLabel('Longitude', { exact: true }).press('0');
    await page.getByRole('button', { name: 'Set pin', exact: true }).press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath('mobile-keyboard-live-guess.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: /Confirm guess/ }).press('Enter');
    await expect(page.getByText('Guess confirmed. Waiting for the group.')).toBeVisible();
    await page.getByText('Host controls', { exact: true }).press('Enter');
    await page.getByRole('button', { name: 'End session', exact: true }).press('Enter');
    await expect(page.getByRole('heading', { name: 'Final scores', exact: true })).toBeVisible();
  } finally {
    await guest.close();
  }
});

const card = (id, kind, title) => ({
  id,
  kind,
  title,
  hostName: 'Test author',
  rounds: 5,
  tags: [],
  createdAt: 1,
});
async function deliver(page, route, body) {
  const received = page.waitForResponse((response) => response.url() === route.request().url());
  await route.fulfill({ json: body });
  await (await received).finished();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}
test('Explore ignores old filters and old pagination responses', async ({ page }) => {
  const pending = new Map();
  await page.route('**/api/catalog?**', (route) => {
    const q = new URL(route.request().url()).searchParams;
    if (!q.get('kind')) return route.fulfill({ json: { items: [], cursor: null } });
    pending.set(`${q.get('kind')}:${q.get('cursor') || 'first'}`, route);
  });
  await page.goto('/explore');
  await page.getByRole('combobox', { name: 'Show', exact: true }).selectOption('official');
  await expect.poll(() => pending.has('official:first')).toBe(true);
  const old = pending.get('official:first');
  await page.getByRole('combobox', { name: 'Show', exact: true }).selectOption('community');
  await expect.poll(() => pending.has('community:first')).toBe(true);
  await deliver(page, pending.get('community:first'), {
    items: [card('community-one', 'community', 'Current community trip')],
    cursor: 'page-two',
  });
  await deliver(page, old, {
    items: [card('official-old', 'official', 'Outdated official trip')],
    cursor: null,
  });
  await expect(page.getByRole('link', { name: 'Current community trip' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Outdated official trip' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Load more', exact: true }).click();
  await expect.poll(() => pending.has('community:page-two')).toBe(true);
  pending.delete('official:first');
  await page.getByRole('combobox', { name: 'Show', exact: true }).selectOption('official');
  await expect.poll(() => pending.has('official:first')).toBe(true);
  await deliver(page, pending.get('official:first'), {
    items: [card('official-new', 'official', 'Current official trip')],
    cursor: null,
  });
  await deliver(page, pending.get('community:page-two'), {
    items: [card('community-two', 'community', 'Outdated page two')],
    cursor: 'page-three',
  });
  await expect(page.getByRole('link', { name: 'Current official trip' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Outdated page two' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Load more', exact: true })).toHaveCount(0);
});

test('admin tabs, score lists and lookups ignore responses for an older selection', async ({
  page,
}) => {
  await signIn(page);
  const pending = new Map();
  const first = card('review-trip-first', 'official', 'First review trip');
  const second = card('review-trip-second', 'official', 'Second review trip');
  await page.route('**/api/admin/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/admin/reports') return route.fulfill({ json: { items: [], cursor: null } });
    pending.set(path, route);
  });
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Photo review', exact: true }).click();
  await expect.poll(() => pending.has('/api/admin/assets')).toBe(true);
  await page.getByRole('button', { name: 'Public trips', exact: true }).click();
  await expect.poll(() => pending.has('/api/admin/publications')).toBe(true);
  await deliver(page, pending.get('/api/admin/publications'), {
    items: [first, second],
    cursor: null,
  });
  await deliver(page, pending.get('/api/admin/assets'), {
    items: [{ id: 'stale-photo', credit: { title: 'Stale photo row' }, createdAt: 1 }],
    cursor: null,
  });
  await expect(page.getByRole('button', { name: /Stale photo row/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Public trips', exact: true }).click();
  await expect(page.locator('.admin-row')).toHaveCount(2);
  await page.locator('.admin-row').filter({ hasText: first.title }).click();
  await expect.poll(() => pending.has(`/api/admin/publications/${first.id}/scores`)).toBe(true);
  await page.locator('.admin-row').filter({ hasText: second.title }).click();
  await expect.poll(() => pending.has(`/api/admin/publications/${second.id}/scores`)).toBe(true);
  await deliver(page, pending.get(`/api/admin/publications/${second.id}/scores`), {
    items: [{ id: 'score-second', name: 'Current player', score: 100 }],
    cursor: null,
  });
  await deliver(page, pending.get(`/api/admin/publications/${first.id}/scores`), {
    items: [{ id: 'score-first', name: 'Stale player', score: 50 }],
    cursor: 'old-cursor',
  });
  await expect(page.getByText(/Current player · 100 points/)).toBeVisible();
  await expect(page.getByText(/Stale player/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Load more scores' })).toHaveCount(0);
  await page.getByLabel('Public trip link or code').fill(first.id);
  await page.getByRole('button', { name: 'Find edition' }).click();
  await expect.poll(() => pending.has(`/api/admin/publications/${first.id}`)).toBe(true);
  await page.locator('.admin-row').filter({ hasText: second.title }).click();
  await deliver(page, pending.get(`/api/admin/publications/${first.id}`), first);
  await expect(page.getByRole('heading', { name: second.title, exact: true })).toBeVisible();
});
