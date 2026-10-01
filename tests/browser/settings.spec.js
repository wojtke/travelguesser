import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page, context }) => {
  await context.route('https://tile.openstreetmap.org/**', (route) => route.abort());
  const session = await (await page.request.get('/api/session')).json();
  await page.request.post('/api/auth/session', {
    headers: { 'X-CSRF-Token': session.csrfToken },
    data: { idToken: 'local-development' },
  });
});

async function openHost(page) {
  await page.goto('/');
  await page
    .locator('.trip-card')
    .filter({ hasText: 'editable-browser-trip' })
    .getByRole('button', { name: 'Host live', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Host a live game' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('live setup has full-width controls, logarithmic timers and reachable slider endpoints', async ({
  page,
}) => {
  const dialog = await openHost(page);
  const number = dialog.getByRole('spinbutton', { name: 'Time per photo', exact: true });
  const slider = dialog.getByRole('slider', { name: 'Time per photo slider' });
  await number.fill('60');
  await expect(slider).toHaveValue('500');
  for (const width of [1440, 820, 390, 320]) {
    await page.setViewportSize({ width, height: width <= 390 ? 700 : 900 });
    const bounds = await dialog.boundingBox();
    if (width > 640) expect(bounds.width).toBeGreaterThanOrEqual(600);
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const timer = await dialog
      .getByRole('combobox', { name: 'Round timer', exact: true })
      .boundingBox();
    const next = await dialog
      .getByRole('combobox', { name: 'Who can start the next round?' })
      .boundingBox();
    expect(next.x).toBe(timer.x);
    expect(next.width).toBe(timer.width);
    await slider.scrollIntoViewIfNeeded();
    const track = await slider.boundingBox();
    expect(track.width).toBe(timer.width);
    for (const [fraction, seconds] of [
      [0, '1'],
      [0.5, '60'],
      [1, '3600'],
    ]) {
      await slider.click({
        position: { x: fraction * (track.width - 2) + 1, y: track.height / 2 },
      });
      await expect(number).toHaveValue(seconds);
      await expect(slider).toHaveAttribute('aria-valuenow', seconds);
    }
    await number.fill('60');
    await dialog.evaluate((el) => el.scrollTo(0, 0));
    await page.screenshot({ path: test.info().outputPath(`host-live-${width}.png`) });
  }
  const dragTrack = await slider.boundingBox();
  await page.mouse.move(dragTrack.x + dragTrack.width / 2, dragTrack.y + dragTrack.height / 2);
  await page.mouse.down();
  await page.mouse.move(dragTrack.x + dragTrack.width - 1, dragTrack.y + dragTrack.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
  await expect(number).toHaveValue('3600');
  await page.mouse.down();
  await page.mouse.move(dragTrack.x + 1, dragTrack.y + dragTrack.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(number).toHaveValue('1');
  await slider.focus();
  await slider.press('Home');
  await expect(number).toHaveValue('1');
  await slider.press('ArrowRight');
  await expect(number).toHaveValue('2');
  await slider.press('ArrowLeft');
  await expect(number).toHaveValue('1');
  await slider.press('End');
  await slider.press('ArrowRight');
  await expect(number).toHaveValue('3600');
  await number.fill('137');
  await expect(slider).toHaveAttribute('aria-valuetext', '137 seconds');
  await slider.press('ArrowLeft');
  await expect(number).toHaveValue('136');
  await number.fill('');
  await dialog.getByRole('button', { name: 'Open lobby', exact: true }).click();
  await expect(dialog).toBeVisible();
  expect(await number.evaluate((el) => el.validity.valueMissing)).toBe(true);
  await number.fill('3601');
  await dialog.getByRole('button', { name: 'Open lobby', exact: true }).click();
  expect(await number.evaluate((el) => el.validity.rangeOverflow)).toBe(true);

  await dialog
    .getByRole('combobox', { name: 'Round timer', exact: true })
    .selectOption('afterFirstLock');
  const countdown = dialog.getByRole('spinbutton', {
    name: 'Time after first confirmation',
    exact: true,
  });
  const countdownSlider = dialog.getByRole('slider', {
    name: 'Time after first confirmation slider',
  });
  await countdownSlider.press('Home');
  await expect(countdown).toHaveValue('1');
  await countdownSlider.press('End');
  await expect(countdown).toHaveValue('3600');
  await countdown.fill('15');
  await dialog.evaluate((el) => el.scrollTo(0, 0));
  await page.screenshot({ path: test.info().outputPath('host-live-countdown-320.png') });
  await dialog.getByRole('combobox', { name: 'Round timer', exact: true }).selectOption('none');
  await expect(dialog.getByRole('slider')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
});

test('hosting sends the chosen seconds, and public friend rooms use the spacious setup too', async ({
  page,
}) => {
  const dialog = await openHost(page);
  let submitted;
  await page.route('**/api/games/editable-browser-trip/live', (route) => {
    submitted = route.request().postDataJSON();
    return route.fulfill({ status: 400, json: { error: 'Synthetic validation response' } });
  });
  await dialog.getByRole('spinbutton', { name: 'Time per photo', exact: true }).fill('137');
  await dialog.getByRole('button', { name: 'Open lobby', exact: true }).click();
  await expect.poll(() => submitted?.timeLimitSeconds).toBe(137);
  expect(submitted.timerMode).toBe('fixed');
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  const edition = (await (await page.request.get('/api/catalog?q=test')).json()).items[0];
  await page.goto(`/p/${edition.id}`);
  await page.getByRole('button', { name: 'Play with friends', exact: true }).click();
  const publicDialog = page.getByRole('dialog', { name: 'Play with friends' });
  await expect(publicDialog).toHaveClass(/game-setup-modal/);
  await page.setViewportSize({ width: 390, height: 700 });
  expect(await publicDialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await publicDialog.getByRole('slider', { name: 'Time per photo slider' }).press('End');
  await expect(
    publicDialog.getByRole('spinbutton', { name: 'Time per photo', exact: true }),
  ).toHaveValue('3600');
  await publicDialog.getByRole('button', { name: 'Create private room' }).scrollIntoViewIfNeeded();
  await expect(publicDialog.getByRole('button', { name: 'Create private room' })).toBeInViewport();
  await publicDialog.getByRole('button', { name: 'Close dialog' }).click();
});
