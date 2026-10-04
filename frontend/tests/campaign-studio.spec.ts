import { test, expect } from '@playwright/test';
import { audienceSegments } from '../src/creative/model';
import { readFileSync } from 'node:fs';

test('segment counts use main affinities, brand membership, minimum size, and safe niches', () => {
  const memberships: { brandUserId: string; userId: string }[] = [];
  const affinities: { userId: string; niche: string; affinity: number }[] = [];
  for (const [niche, count] of [['dev_tools', 16], ['ai_agents_tools', 14], ['politics_society', 16], ['other', 15]] as const) {
    for (let index = 0; index < count; index++) {
      const userId = `${niche}-${index}`;
      memberships.push({ brandUserId: 'selected-brand', userId });
      affinities.push({ userId, niche, affinity: .9 }, { userId, niche: 'design_creative', affinity: .1 });
    }
  }
  // Equal-affinity ties resolve by niche slug, consistent with the worker and reducer.
  affinities.push({ userId: 'dev_tools-0', niche: 'ai_agents_tools', affinity: .9 });
  for (let index = 0; index < 20; index++) {
    memberships.push({ brandUserId: 'another-brand', userId: `foreign-${index}` });
    affinities.push({ userId: `foreign-${index}`, niche: 'design_creative', affinity: 1 });
  }
  const catalog = ['dev_tools', 'ai_agents_tools', 'politics_society', 'other', 'design_creative'].map(slug => ({ slug, label: slug, description: '' }));
  const result = audienceSegments('selected-brand', memberships, affinities, catalog);
  expect(result.total).toBe(61);
  expect(result.segments.map(segment => [segment.slug, segment.count])).toEqual([['ai_agents_tools', 15], ['dev_tools', 15]]);
  expect(result.segments[0].share).toBeCloseTo(15 / 61);
});

test('campaigns are a separate tab with a compact creation dialog', async ({ page }) => {
  await page.routeWebSocket('**/*', socket => socket.close({ code: 1001, reason: 'Offline test' }));
  await page.goto('/campaigns?brand=raycast.com');
  const nav = page.getByRole('navigation', { name: 'Workspace navigation' });
  // The workspace nav is Home · Audience · Campaign · Lab; Studio and Lab v2 stay reachable by URL.
  await expect(nav.getByRole('link', { name: 'Campaign', exact: true })).toHaveAttribute('href', '/campaign?brand=raycast.com');
  await expect(nav.getByRole('link', { name: 'Lab', exact: true })).toHaveAttribute('href', '/lab?brand=raycast.com');
  await expect(nav.getByRole('link', { name: 'Lab v2', exact: true })).toHaveCount(0);
  await expect(page.getByText('Campaigns are unavailable.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New campaign', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Campaign goal')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Create brief' })).toBeDisabled();
  await dialog.getByText('Format', { exact: true }).click();
  await dialog.getByRole('button', { name: '9:16', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '9:16', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

test('recorded campaign transfers two images and brief context into Lab v2', async ({ page }) => {
  await page.routeWebSocket('**/*', socket => socket.close({ code: 1001, reason: 'Offline test' }));
  const pageErrors: string[] = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto('/campaigns?demo=1');
  await expect(page.getByText('Recorded demo', { exact: true })).toBeVisible();
  const concepts = page.locator('.campaign-concept');
  await expect(concepts.first()).toBeVisible();
  await concepts.nth(0).getByRole('button', { name: 'Select', exact: true }).click();
  await concepts.nth(1).getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByRole('button', { name: 'Open in Lab v2' }).click();
  await expect(page).toHaveURL(/lab-v2.*handoff=/);
  await expect(page.getByLabel('Draft A')).not.toHaveValue('');
  await expect(page.locator('.v2-image')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Run in Lab', exact: true })).toBeEnabled();
  await page.getByText('Sample tools', { exact: true }).click();
  await page.getByRole('button', { name: 'Compare sample', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Sample results' })).toContainText('Illustrative');
  await expect(page.getByRole('navigation', { name: 'Sample comparison history' }).getByRole('button')).toHaveCount(2);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export sample', exact: true }).click();
  const report = JSON.parse(readFileSync((await (await download).path())!, 'utf8'));
  expect(report.mode).toBe('illustrative-preview');
  expect(report.calibrated).toBe(false);
  expect(report.creativeContext.recordedRehearsal).toBe(true);
  expect(report.creativeContext.variants).toHaveLength(2);
  expect(typeof report.creativeContext.variants[0].costUsdTicks).toBe('string');
  expect(pageErrors).toEqual([]);
  await page.screenshot({ path: '/private/tmp/ripple-lab-v2-dark.png', fullPage: true });
});

test('Lab v2 preserves optional third draft and sample history', async ({ page }) => {
  await page.goto('/lab-v2');
  await page.getByText('Sample tools', { exact: true }).click();
  await page.getByRole('button', { name: 'Add a third draft' }).click();
  await expect(page.getByRole('button', { name: 'Run in Lab', exact: true })).toBeDisabled();
  await page.getByRole('textbox', { name: 'Draft C', exact: true }).fill('A useful third angle. Try it?');
  await page.getByRole('button', { name: 'Compare sample', exact: true }).click();
  await expect(page.locator('.v2-results .campaign-grid > article')).toHaveCount(3);
  await page.getByText('Sample network', { exact: true }).click();
  const network = page.getByRole('img', { name: /^Interactive three-dimensional/ });
  await expect(network).toBeVisible();
  expect((await network.boundingBox())!.height).toBeGreaterThan(300);
  await page.getByRole('button', { name: 'Pause cascade' }).click();
  await expect(page.getByRole('button', { name: 'Play cascade', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Replay cascade' }).click();
  await expect(page.getByRole('button', { name: 'Pause cascade' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove draft C' }).click();
  await expect(page.getByRole('button', { name: 'Run in Lab', exact: true })).toBeEnabled();
  await expect(page.getByText('Drafts changed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New comparison' }).click();
  const history = page.getByRole('navigation', { name: 'Sample comparison history' });
  await history.getByRole('button').nth(1).click();
  await expect(page.getByRole('textbox', { name: 'Draft C', exact: true })).toHaveValue('A useful third angle. Try it?');
});

test('Campaigns and Lab v2 fit mobile in both themes', async ({ page }) => {
  await page.routeWebSocket('**/*', socket => socket.close({ code: 1001, reason: 'Offline test' }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/campaigns?demo=1');
  await expect(page.locator('.campaign-concept').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.screenshot({ path: '/private/tmp/ripple-campaigns-mobile-light.png', fullPage: true });
  await page.goto('/lab-v2?brand=raycast.com');
  await expect(page.getByLabel('Draft A')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

// Contract check only: no provider or real database mutations.
test('Run in Lab submits the exact edited text through the existing reducer', async ({ page }) => {
  let accepted: string[] | null = null;
  let reads = 0;
  await page.route('**/v1/identity', route => route.fulfill({ json: { token: 'test-token' } }));
  await page.route('**/call/request_lab_experiment', async route => {
    accepted = route.request().postDataJSON();
    await route.fulfill({ status: 200, body: '' });
  });
  await page.route('**/v1/database/ripple-mhacks/sql', route => {
    reads++;
    const columns = ['experiment_id', 'title', 'draft_a', 'draft_b'];
    return route.fulfill({ json: [{ schema: { elements: columns.map(name => ({ name: { some: name }, algebraic_type: {} })) },
      rows: accepted ? [['42', accepted[1], accepted[2], accepted[3]]] : [] }] });
  });
  await page.goto('/lab-v2?brand=raycast.com');
  await page.getByLabel('Draft A').fill('Campaign A: concrete benefits.');
  await page.getByLabel('Draft B').fill('Campaign B: try it yourself?');
  await page.getByRole('button', { name: 'Run in Lab', exact: true }).click();
  await expect(page).toHaveURL(/\/lab\?brand=raycast.com&exp=42/);
  expect(accepted).toEqual(['raycast.com', 'Campaign comparison', 'Campaign A: concrete benefits.', 'Campaign B: try it yourself?']);
  expect(reads).toBeGreaterThanOrEqual(2);
});

test('rejected simulation request keeps drafts available to retry', async ({ page }) => {
  await page.route('**/v1/identity', route => route.fulfill({ json: { token: 'test-token' } }));
  await page.route('**/v1/database/ripple-mhacks/sql', route => route.fulfill({ json: [] }));
  await page.route('**/call/request_lab_experiment', route => route.fulfill({ status: 400, body: 'SenderError: at most 2 experiments can run at once' }));
  await page.goto('/lab-v2');
  const before = await page.getByLabel('Draft A').inputValue();
  await page.getByRole('button', { name: 'Run in Lab', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('at most 2 experiments');
  await expect(page.getByLabel('Draft A')).toHaveValue(before);
  await expect(page.getByRole('button', { name: 'Run in Lab', exact: true })).toBeEnabled();
});

test('workspace navigation leaves room for brand controls on smaller desktops', async ({ page }) => {
  await page.routeWebSocket('**/*', socket => socket.close({ code: 1001, reason: 'Offline test' }));
  await page.goto('/campaigns?demo=1');
  await expect(page.locator('.campaign-concept').first()).toBeVisible();
  for (const width of [1280, 1024, 920]) {
    await page.setViewportSize({ width, height: 900 });
    const navigation = page.locator('.fd-desktop');
    const nav = await navigation.boundingBox();
    const brands = await page.getByRole('navigation', { name: 'Audience', exact: true }).boundingBox();
    if (nav) expect(nav.x + nav.width).toBeLessThanOrEqual(brands!.x);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: '/private/tmp/ripple-campaigns-desktop-dark.png', fullPage: true });
});
