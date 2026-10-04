import { test, expect, type Page } from '@playwright/test';
const owner = 'a'.repeat(64);
const row = (id: number, handle: string, status = 'ready') => ({ onboarding_id: id, handle, status, brand_user_id: `${handle}-id`, campaign_name: `Launch ${id}`, created_at: Date.now() * 1000 });
async function setup(page: Page, rows: Record<string, unknown>[] = [row(9, 'raycast'), row(10, 'linear', 'twins')], fail = false) {
  await page.route('**/node_modules/.vite/deps/@clerk_react.js*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export const ClerkProvider = p => p.children;
    export const Show = p => p.when === 'signed-in' ? p.children : null;
    export const UserButton = () => null;
    export const ClerkLoading = () => null;
  ` }));
  await page.route('**/src/module_bindings/index.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export const DbConnection = { builder() {
      let connected;
      const context = { disconnect() {} };
      const builder = { withUri() { return this; }, withDatabaseName() { return this; }, withToken() { return this; },
        onConnect(fn) { connected = fn; return this; }, onConnectError() { return this; },
        build() { queueMicrotask(() => connected(context, { toHexString: () => '${owner}' })); return context; } };
      return builder;
    } };
  ` }));
  await page.route('https://maincloud.spacetimedb.com/**', route => {
    if (route.request().url().endsWith('/identity')) return route.fulfill({ json: { token: 'test-session-token' } });
    const query = route.request().postData() ?? '';
    if (fail) return route.fulfill({ status: 503, body: 'Unavailable' });
    let result: Record<string, unknown>[] = [];
    if (query.includes('FROM onboarding')) {
      expect(query).toBe(`SELECT * FROM onboarding WHERE requested_by = 0x${owner}`); result = rows;
    } else if (query.includes('FROM audience_membership')) {
      const prefix = query.includes('raycast-id') ? 'r' : 'l';
      result = [{ follower_user_id: 'shared' }, { follower_user_id: prefix + '1' }, { follower_user_id: prefix + '2' }];
    } else if (query.includes('FROM twin_audience')) {
      const prefix = query.includes('raycast-id') ? 'r' : 'l';
      result = [{ user_id: 'shared' }, { user_id: prefix + '1' }, { user_id: 'obsolete-profile' }];
    } else if (query.includes('FROM campaign_flow')) {
      expect(query).toBe(`SELECT * FROM campaign_flow WHERE requested_by = 0x${owner}`);
      result = [{ campaign_id: 'campaign-42', brand: 'raycast', source: 'generate', stage: 'testing', created_at: Date.now() * 1000 + 1e6 }];
    } else if (query.includes('FROM ops_hidden')) {
      result = [];
    } else throw new Error(`Unexpected query: ${query}`);
    const keys = result.length ? Object.keys(result[0]) : ['onboarding_id'];
    return route.fulfill({ json: [{ schema: { elements: keys.map(key => ({ name: { some: key }, algebraic_type: { String: {} } })) }, rows: result.map(item => keys.map(key => item[key])) }] });
  });
}

test('signed-in landing opens Home and recent campaigns link to maps or builds', async ({ page }) => {
  await setup(page);
  await page.goto('/');
  await page.getByRole('link', { name: 'Open workspace' }).click();
  await expect(page).toHaveURL('/home');
  await expect(page.getByRole('heading', { name: 'Recent campaigns' })).toBeVisible();
  await expect(page.locator('.home-campaign')).toHaveCount(2);
  await expect(page.locator('.home-campaign').first()).toHaveAttribute('href', '/onboarding?flow=campaign&build=10');
  await expect(page.locator('.home-campaign').last()).toHaveAttribute('href', '/dashboard?brand=raycast');
  await expect(page.getByRole('link', { name: 'Home', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('link', { name: 'New campaign', exact: true })).toHaveAttribute('href', '/campaign?brand=raycast');
  await expect(page.getByText('Analyzing your audience', { exact: true })).toBeVisible();
});

test('Home empty state, mobile layout and persisted light theme', async ({ page }) => {
  await setup(page, []);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/home');
  await expect(page.getByText('Your next campaign starts here.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Connect an X handle' })).toHaveAttribute('href', '/onboarding?flow=campaign');
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/ripple-home-mobile.png', fullPage: true });
});

test('Home read errors show a retry control', async ({ page }) => {
  await setup(page, [], true);
  await page.goto('/home');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});


test('Home shows all discovered profiles as analyzed without changing source counts', async ({ page }) => {
  await setup(page);
  await page.goto('/home');
  const headline = page.getByRole('heading', { name: 'A little clarity.', exact: true });
  await expect(headline).toBeVisible();
  await expect(page.getByText('A bigger ripple.')).toHaveCount(0);
  await expect(headline).toHaveCSS('white-space', 'nowrap');
  const stats = page.getByRole('region', { name: 'Workspace stats' });
  await expect(stats.locator('.home-stat-strip strong')).toHaveText(['5', '5', '2']);
  await expect(page.getByRole('img', { name: /Audience profiles by brand/ })).toHaveAttribute('aria-label', /@raycast, 3 found, 3 analyzed/);
  await expect(page.locator('.home-cloud')).toHaveCSS('background-image', /login-dark\.png/);
  await expect(page.getByRole('link', { name: 'Ripple home' })).toHaveText('Ripple');
  const logo = page.getByRole('link', { name: 'Ripple home' });
  await expect(logo.locator('svg')).toHaveCSS('color', 'rgb(230, 188, 136)');
  const chart = await page.locator('.home-overview').boundingBox(), sidebar = await page.locator('.home-recent').boundingBox();
  expect(sidebar!.x).toBeGreaterThan(chart!.x + chart!.width);
  await page.screenshot({ path: '/tmp/ripple-home-stats-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('.home-cloud')).toHaveCSS('background-image', /login-light\.png/);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/ripple-home-stats-mobile.png', fullPage: true });
});

test('Home resumes owned campaign flows in its recent sidebar', async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => localStorage.setItem('ripple-creative-token:wss://maincloud.spacetimedb.com:ripple-mhacks', 'test-creative-token'));
  await page.goto('/home');
  await expect(page.locator('.home-campaign').first()).toHaveAttribute('href', '/campaign?brand=raycast&id=campaign-42');
  await expect(page.locator('.home-campaign').first()).toContainText('In the Lab');
});
