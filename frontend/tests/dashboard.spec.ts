import { test, expect } from '@playwright/test';

test('sample drafts compare, reopen from history, and export', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Your next ripple.', exact: true })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Workspace navigation' });
  await nav.getByRole('button', { name: 'Draft lab' }).click();
  await page.getByRole('button', { name: 'Add a third draft' }).click();
  await page.getByRole('button', { name: 'Compare sample drafts' }).click();
  await expect(page.getByRole('alert')).toContainText('Add text to every draft');
  await page.getByLabel('Draft C').fill('Can your next idea find a new audience? Try this public demo and tell us what surprised you.');
  await page.getByLabel('Runs per draft').selectOption('50');
  await page.getByRole('button', { name: 'Compare sample drafts' }).click();
  await expect(page.getByRole('status')).toContainText('Sample comparison complete');
  await expect(page.getByRole('button', { name: 'Draft C', exact: true })).toBeVisible();
  await nav.getByRole('button', { name: 'Simulation history' }).click();
  await page.getByRole('button', { name: /Comparison 1/ }).click();
  await expect(page.getByRole('status')).toContainText('Opened sample comparison 1');
  await nav.getByRole('button', { name: 'Simulation history' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export sample' }).click();
  expect((await downloadPromise).suggestedFilename()).toBe('ripple-sample-comparison.json');
});

test('mobile workspace navigation, audience validation and theme work', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('button', { name: 'Audience', exact: true }).click();
  await page.getByLabel('Bluesky handle').fill('invalid');
  await page.getByRole('button', { name: 'Update sample label' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByLabel('Bluesky handle').fill('@maker.bsky.social');
  await page.getByRole('button', { name: 'Update sample label' }).click();
  await expect(page.getByRole('status')).toContainText('No live Bluesky data was fetched');
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open navigation' })).toHaveAttribute('aria-expanded', 'false');
});
