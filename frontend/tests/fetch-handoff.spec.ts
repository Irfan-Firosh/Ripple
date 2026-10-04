import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Rehearse scripts/fetch_demo_check.py first. These checks only read its live output and database.
test.skip(process.env.RIPPLE_FETCH_LIVE_TEST !== '1', 'Requires the live Fetch demo rehearsal.');
test.setTimeout(360_000);

function resultLink(pattern: RegExp): string {
  const events = JSON.parse(readFileSync('/tmp/ripple-fetch-demo.json', 'utf8')) as { kind: string; text?: string }[];
  const match = events.filter(e => e.kind === 'result').map(e => e.text ?? '').join('\n').match(pattern);
  if (!match) throw new Error('The live chat has not produced this handoff yet.');
  const url = new URL(match[1]);
  return url.pathname + url.search;
}

test('chat-created campaign opens its actual company and images in a fresh browser', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  let link = '';
  await expect.poll(() => {
    try { link = resultLink(/\[Open campaign studio\]\(([^)]+)\)/); return true; } catch { return false; }
  }, { timeout: 300_000, intervals: [3000] }).toBe(true);
  await page.goto(link);
  await expect(page.getByRole('navigation', { name: 'Audience', exact: true }).getByRole('button', { name: '@supermemory', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.campaign-concept')).toHaveCount(6, { timeout: 60_000 });
  await expect(page.locator('.campaign-image img')).toHaveCount(6);
  await expect.poll(() => page.locator('.campaign-image img').evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await page.locator('.campaign-concept').nth(0).getByRole('button', { name: 'Select', exact: true }).click();
  await page.locator('.campaign-concept').nth(1).getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByRole('button', { name: 'Open in Lab v2' }).click();
  await expect(page.getByLabel('Draft A', { exact: true })).not.toHaveValue('');
  await expect(page.locator('.v2-image')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('exact A/B chat result opens its persisted experiment and replay', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  let link = '';
  await expect.poll(() => {
    try { link = resultLink(/\[Watch A vs B play out live\]\(([^)]+)\)/); return true; } catch { return false; }
  }, { timeout: 300_000, intervals: [3000] }).toBe(true);
  await page.goto(link);
  await expect(page.getByRole('article', { name: 'Draft A', exact: true })).toContainText('Open source memory for agents. Add memory today.', { timeout: 60_000 });
  await expect(page.getByRole('article', { name: 'Draft B', exact: true })).toContainText('Ship smarter agents faster. Add memory today.');
  await expect(page).toHaveURL(new RegExp(link.replace(/[?]/g, '\\?')));
  await page.getByRole('button', { name: 'Replay', exact: true }).click();
  await expect(page.getByText(/(A|B) wins|Too close to call/)).toBeVisible({ timeout: 60_000 });
  await page.getByRole('navigation', { name: 'Experiments' }).getByRole('button', { name: 'New experiment' }).click();
  await expect(page.getByRole('dialog', { name: 'New experiment' }).getByRole('button', { name: 'Run in Lab' })).toBeDisabled();
  expect(errors).toEqual([]);
});

test('fresh-company onboarding opens its live graph with the correct handle', async ({ page }) => {
  await page.goto('/onboarding?brand=resend');
  await expect(page.getByRole('list', { name: 'Build stages' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'See your audience' })).toBeEnabled({ timeout: 300_000 });
  await page.getByRole('button', { name: 'See your audience' }).click();
  await expect(page).toHaveURL(/\/dashboard\?brand=resend$/);
  await expect(page.locator('canvas[data-node-count]')).toHaveAttribute('data-node-count', /^[1-9]\d*$/, { timeout: 60_000 });
});
