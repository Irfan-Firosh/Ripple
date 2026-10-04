import { test, expect } from '@playwright/test';

// These tests read the real scraped audience from SpacetimeDB (no mock data), so they need network access.
const SQL = '**/v1/database/ripple-mhacks/sql';
test.describe.configure({timeout:60000});

test('dashboard shows the loader, then the live audience with real counts and niches', async ({ page }) => {
  await page.route(SQL, async route => { await new Promise(r => setTimeout(r, 800)); await route.continue(); });
  await page.goto('/dashboard');
  await expect(page).toHaveTitle('Dashboard — Ripple');
  await expect(page.getByRole('status')).toContainText('Reading the audience from SpacetimeDB');
  await expect(page.locator('[data-slot="loader"] canvas')).toBeVisible();

  const canvas = page.getByRole('img', { name: /Three-dimensional audience network/ });
  await expect(canvas).toBeVisible({ timeout: 45000 });
  const people = Number(await canvas.getAttribute('data-node-count'));
  expect(people).toBeGreaterThan(50); // every person is retained within the interactive size budget
  await expect(page.getByText(`${people} people`)).toBeVisible();
  await expect.poll(async () => Number(await canvas.getAttribute('data-active-count'))).toBeGreaterThan(0);

  // At most 10 niche groups, and every person still belongs to one of them.
  const groups = page.getByLabel('Niche index').locator('.nt-community-index button');
  expect(await groups.count()).toBeLessThanOrEqual(10);
  const sizes = await page.getByLabel('Niche index').locator('.nt-index-count').allTextContents();
  expect(sizes.reduce((sum, n) => sum + Number(n), 0)).toBe(people);
  await expect(page.getByLabel('Niche index')).not.toContainText(/other/i); // every group is a real niche

  // Start a fresh run: slow live-data assertions may outlast the first autoplay.
  await page.getByRole('button', { name: 'Replay', exact: true }).click();
  await page.getByRole('button', { name: 'Pause cascade' }).click();
  const count = await canvas.getAttribute('data-active-count');
  await page.waitForTimeout(500);
  await expect(canvas).toHaveAttribute('data-active-count', count!);
  await page.getByRole('button', { name: 'Replay', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-active-count', '0');

  const niche = page.getByLabel('Niche index').getByRole('button', { name: /^01 / });
  await niche.click();
  await expect(niche).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => Number(await canvas.getAttribute('data-camera-y'))).toBeLessThan(-100); // niche 01 sits at the top of the ring
  await page.getByRole('button', { name: 'All niches', exact: true }).click();
  await expect.poll(async () => Number(await canvas.getAttribute('data-camera-y'))).toBeCloseTo(0, 0);
  await expect(page.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('link', { name: 'Home', exact: true })).toHaveAttribute('href', '/');
});

test('mobile dashboard finishes the cascade with reduced motion and has no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/dashboard');
  const canvas = page.getByRole('img', { name: /Three-dimensional audience network/ });
  await expect(canvas).toBeVisible({ timeout: 45000 });
  const people = await canvas.getAttribute('data-node-count');
  await expect(canvas).toHaveAttribute('data-active-count', people!);
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('dashboard says so when SpacetimeDB cannot be reached, and retries', async ({ page }) => {
  let fail = true;
  await page.route(SQL, route => (fail ? route.abort() : route.continue()));
  await page.goto('/dashboard');
  await expect(page.getByRole('status')).toContainText("Couldn't load the audience");
  fail = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('img', { name: /Three-dimensional audience network/ })).toBeVisible({ timeout: 45000 });
});

test('Raycast (Bluesky) audience renders every twin in at most 7 niche groups', async ({ page }) => {
  await page.goto('/dashboard?brand=raycast.com');
  await expect(page.getByRole('link', { name: /Raycast/ })).toHaveAttribute('aria-current', 'page');
  const canvas = page.getByRole('img', { name: /Three-dimensional audience network/ });
  await expect(canvas).toBeVisible({ timeout: 45000 });
  const people = Number(await canvas.getAttribute('data-node-count'));
  expect(people).toBeGreaterThan(900);
  const index = page.getByLabel('Niche index');
  expect(await index.locator('.nt-community-index button').count()).toBeLessThanOrEqual(7);
  const sizes = await index.locator('.nt-index-count').allTextContents();
  expect(sizes.reduce((sum, n) => sum + Number(n), 0)).toBe(people);
  await expect(index).not.toContainText(/other/i); // no catch-all bucket: each person sits in a real niche
});

test('a simulation run replays live from SpacetimeDB', async ({ page }) => {
  const runId = process.env.RIPPLE_TEST_RUN_ID;
  test.skip(!runId, 'set RIPPLE_TEST_RUN_ID to a run created by the simulation agent');
  await page.goto(`/dashboard?brand=spacetimedb&run=${runId}`);
  const canvas = page.getByRole('img', { name: /Three-dimensional audience network/ });
  await expect(canvas).toBeVisible({ timeout: 20000 });
  await expect(canvas).toHaveAttribute('data-run', runId!);
  await expect(page.getByText(/likely reach \d+–\d+/)).toBeVisible();
  await expect.poll(async () => Number(await canvas.getAttribute('data-engaged-count'))).toBeGreaterThan(0);
});

test('landing-style desktop navigation opens the Lab for the current brand', async ({ page }) => {
  await page.goto('/dashboard?brand=raycast.com');
  const nav = page.getByRole('navigation', { name: 'Workspace navigation' });
  const audience = nav.getByRole('link', { name: 'Audience', exact: true });
  await expect(audience).toHaveAttribute('aria-current', 'page');
  const lab = nav.getByRole('link', { name: 'Lab', exact: true });
  await expect(lab).toHaveAttribute('href', '/lab?brand=raycast.com');
  await expect(nav).toContainText('HomeAudienceCampaignsLabLab v2');
  expect(await nav.evaluate(el => getComputedStyle(el).borderRadius)).toBe('999px');
  await expect(nav.locator('svg')).toHaveCount(0);
  await lab.click();
  await expect(page).toHaveURL(/\/lab\?brand=raycast.com/);
  await expect(page.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('link', { name: 'Lab', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('mobile floating navigation opens below its toggle and supports Escape without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/dashboard');
  const toggle = page.getByRole('button', { name: 'Open navigation' });
  await toggle.click();
  const nav = page.getByRole('navigation', { name: 'Workspace navigation' });
  await expect(nav).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close navigation' })).toHaveAttribute('aria-expanded', 'true');
  const bounds = await nav.boundingBox(), buttonBounds = await page.getByRole('button', { name: 'Close navigation' }).boundingBox();
  expect(bounds!.y).toBeGreaterThan(buttonBounds!.y + buttonBounds!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await nav.getByRole('link', { name: 'Lab', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(toggle).toBeFocused();
  await expect(nav).not.toBeVisible();
  await toggle.click();
  await page.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('link', { name: 'Lab', exact: true }).click();
  await expect(page).toHaveURL(/\/lab\?brand=spacetimedb/);
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
});
