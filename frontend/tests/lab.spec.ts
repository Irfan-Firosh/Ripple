import { test, expect } from '@playwright/test';

// Live data from SpacetimeDB (no mocks). Experiment 7 is a finished Raycast A/B run with comments.
test.describe.configure({ timeout: 90000 });

test('lab shows two tweets whose interactions play out live, in whole numbers, with comments', async ({ page }) => {
  await page.goto('/lab?brand=raycast.com&exp=7');
  const a = page.getByRole('article', { name: 'Draft A' });
  const b = page.getByRole('article', { name: 'Draft B' });
  await expect(a).toBeVisible({ timeout: 30000 });
  await expect(b).toBeVisible();
  await expect(a).toContainText('Raycast for Windows is here.');
  for (const metric of ['replies', 'reposts', 'likes', 'views']) await expect(a.locator(`[data-metric="${metric}"]`)).toBeVisible();
  // Counters start low and climb while the replay plays.
  const likes = a.locator('[data-metric="likes"] [data-count]');
  // Profile loading may outlast autoplay; explicitly restart the real recorded trial.
  await page.getByRole('button', { name: 'Replay', exact: true }).click();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  const first = Number(await likes.getAttribute('data-count'));
  await expect.poll(async () => Number(await likes.getAttribute('data-count')), { timeout: 30000 }).toBeGreaterThan(first);
  // Every visible count is a whole number.
  for (const text of await page.locator('[data-count]').allTextContents()) expect(text).toMatch(/^\d{1,3}(,\d{3})*$/);
  // Comments show up under the tweets as replies.
  await expect(page.getByRole('article', { name: /^Reply from/ }).first()).toBeVisible({ timeout: 30000 });
  // Finished: a winner is declared.
  await expect(page.getByText(/(A|B) wins|Too close to call/)).toBeVisible({ timeout: 40000 });
  await expect(page.locator('body')).not.toContainText(/wind tunnel|bookmark|likes on reposts/i);
});

test('dock navigates experiments and the composer validates drafts', async ({ page }) => {
  await page.goto('/lab?brand=raycast.com&exp=7');
  const dock = page.getByRole('navigation', { name: 'Experiments' });
  await expect(dock.getByRole('button', { name: /Local AI launch/ }).first()).toBeVisible({ timeout: 30000 });
  await dock.getByRole('button', { name: /Local AI launch/ }).first().click();
  await expect(page).toHaveURL(/exp=3/);
  await dock.getByRole('button', { name: 'New experiment' }).click();
  const dialog = page.getByRole('dialog', { name: 'New experiment' });
  await expect(dialog.getByRole('button', { name: 'Run in Lab' })).toBeDisabled();
  await dialog.getByLabel('Draft A').fill('x'.repeat(1001));
  await dialog.getByLabel('Draft B').fill('ok');
  await expect(dialog.getByText(/at most 1000 characters/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Run in Lab' })).toBeDisabled();
});

test('lab has no sideways scroll on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/lab?brand=raycast.com&exp=7');
  await expect(page.getByRole('article', { name: 'Draft A' })).toBeVisible({ timeout: 30000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
