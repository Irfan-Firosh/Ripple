import { test, expect } from '@playwright/test';
test.describe.configure({ timeout: 90000 });

test('islands retain real people, focus niches, and replay real Lab counts', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/lab-game?brand=raycast.com&exp=3');
  const canvas = page.locator('.lg-canvas canvas');
  await expect(canvas).toHaveAttribute('data-ready', 'true', { timeout: 60000 });
  const count = Number(await canvas.getAttribute('data-people'));
  expect(count).toBeGreaterThan(50);
  const options = page.getByLabel('Audience person').locator('option');
  await expect(options).toHaveCount(count + 1);
  await expect(page.getByLabel('Experiment', { exact: true })).not.toHaveValue('', { timeout: 30000 });
  await expect(page.getByLabel('Replay', { exact: true })).toBeEnabled({ timeout: 30000 });
  await page.getByLabel('Replay', { exact: true }).click();
  await page.getByLabel('Pause replay').click();
  const tick = await canvas.getAttribute('data-tick');
  await page.waitForTimeout(300);
  await expect(canvas).toHaveAttribute('data-tick', tick!);
  await page.getByLabel('Play replay').click();
  await expect.poll(async () => Number(await canvas.getAttribute('data-tick')), { timeout: 20000 }).toBeGreaterThan(0);
  const zoom = Number(await canvas.getAttribute('data-zoom'));
  await page.getByLabel('Niche index').getByRole('button').nth(1).click();
  await expect.poll(async () => Number(await canvas.getAttribute('data-zoom'))).toBeGreaterThan(zoom);
  await page.getByLabel('Audience person').selectOption({ index: 1 });
  await expect(page.getByLabel('Selected person')).toBeVisible();
  await page.getByLabel('Close person').click();
  await page.getByRole('button', { name: 'Draft B', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Draft B', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/brand=raycast.com.*exp=/);
  expect(errors).toEqual([]);
});

test('mobile islands support light theme and reduced motion without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/lab-game?brand=spacetimedb');
  const canvas = page.locator('.lg-canvas canvas');
  await expect(canvas).toHaveAttribute('data-ready', 'true', { timeout: 60000 });
  await expect(canvas).toHaveAttribute('data-motion', 'still');
  await page.getByRole('button', { name: 'Use light theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('Niche index').getByRole('button').nth(1).click();
  await page.getByLabel('Audience person').selectOption({ index: 1 });
  await expect(page.getByLabel('Selected person')).toBeVisible();
  await expect(page.locator('.lg-canvas canvas')).toHaveCount(1);
});
