import { test, expect } from '@playwright/test';

import { audienceFixture } from './audience-fixture';
test.beforeEach(async ({ page }) => { await audienceFixture(page, 80); });
const SQL = '**/v1/database/ripple-mhacks/sql';
test.describe.configure({timeout:60000});

test('dashboard shows the loader, then the live audience with real counts and niches', async ({ page }) => {
  await page.route(SQL, async route => { await new Promise(r => setTimeout(r, 800)); await route.fallback(); });
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

  await expect(canvas).toHaveAttribute('data-active-count', String(people));
  await expect(canvas).toHaveAttribute('data-source-node-count', '0');
  await expect(page.getByRole('button', {name: 'Replay', exact: true})).toHaveCount(0);

  const niche = page.getByLabel('Niche index').getByRole('button', { name: /^01 / });
  await niche.click();
  await expect(niche).toHaveAttribute('aria-pressed', 'true');
  await expect(canvas).toHaveAttribute('data-focus-community', '0'); // niche 01 sits at the top of the ring
  await page.getByRole('button', { name: 'All niches', exact: true }).click();
  await expect.poll(async () => Number(await canvas.getAttribute('data-camera-y'))).toBeCloseTo(0, 0);
  await expect(page.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('link', { name: 'Home', exact: true })).toHaveAttribute('href', '/home');
});

test('mobile dashboard shows every person immediately and has no sideways scroll', async ({ page }) => {
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
  await page.route(SQL, route => (fail ? route.abort() : route.fallback()));
  await page.goto('/dashboard');
  await expect(page.getByRole('status')).toContainText("Couldn't load the audience");
  fail = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('img', { name: /Three-dimensional audience network/ })).toBeVisible({ timeout: 45000 });
});

test('an arbitrary onboarded X handle renders every person in the niche index', async ({ page }) => {
  await page.goto('/dashboard?brand=spacetimedb');
  const canvas = page.getByRole('img', { name: /Three-dimensional audience network/ });
  await expect(canvas).toHaveAttribute('data-node-count', '80');
  const index = page.getByLabel('Niche index');
  const sizes = await index.locator('.nt-index-count').allTextContents();
  expect(sizes.reduce((sum, n) => sum + Number(n), 0)).toBe(80);
});

test('landing-style desktop navigation opens the Lab for the current brand', async ({ page }) => {
  await page.goto('/dashboard?brand=raycast.com');
  const nav = page.getByRole('navigation', { name: 'Workspace navigation' });
  const audience = nav.getByRole('link', { name: 'Audience', exact: true });
  await expect(audience).toHaveAttribute('aria-current', 'page');
  const lab = nav.getByRole('link', { name: 'Lab', exact: true });
  await expect(lab).toHaveAttribute('href', '/lab?brand=raycast.com');
  await expect(nav).toContainText('HomeAudienceCampaignLab');
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
  await expect(page.getByRole('img', { name: /Three-dimensional audience network/ })).toBeVisible();
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
