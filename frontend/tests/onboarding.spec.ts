import { test, expect, type Page } from '@playwright/test';

type RecordRow = Record<string, unknown>;
type MockState = { status: string; ready: number; error: string | null; reducerError: string; briefError: string; calls: { name: string; args: unknown[] }[]; polls: number };
const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><rect width="28" height="28" fill="#888"/></svg>');
function wire(rows: RecordRow[]) {
  const keys = Object.keys(rows[0] ?? {});
  return [{ schema: { elements: keys.map(name => ({ name: { some: name }, algebraic_type: name === 'error'
    ? { Sum: { variants: [{ name: { some: 'some' }, algebraic_type: { String: {} } }, { name: { some: 'none' }, algebraic_type: { Product: { elements: [] } } }] } }
    : { String: {} } })) }, rows: rows.map(row => keys.map(key => key === 'error' ? row[key] === null ? [1, []] : [0, row[key]] : row[key])) }];
}
async function mockDatabase(page: Page): Promise<MockState> {
  const state: MockState = { status: 'scraping', ready: 0, error: null, reducerError: '', briefError: '', calls: [], polls: 0 };
  const users: RecordRow[] = [{ user_id: 'brand', username: 'raycast', name: 'Raycast', profile_image_url: image, followers_count: 300 },
    ...Array.from({ length: 30 }, (_, i) => ({ user_id: `person-${i}`, username: `person${i}`, name: `Person ${i}`, profile_image_url: image, followers_count: 100 }))];
  await page.route('https://maincloud.spacetimedb.com/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === '/v1/identity') return route.fulfill({ json: { token: 'onboarding-test-token' } });
    if (path.includes('/call/')) {
      const name = path.split('/').pop()!;
      state.calls.push({ name, args: request.postDataJSON() as unknown[] });
      expect(request.headers().authorization).toBe('Bearer onboarding-test-token');
      const error = name === 'request_onboarding' ? state.reducerError : state.briefError;
      return route.fulfill({ status: error ? 400 : 200, body: error ? `reducer failed: SenderError: ${error}` : '' });
    }
    if (!path.endsWith('/sql')) throw new Error(`Unexpected database request: ${path}`);
    const query = request.postData() ?? '', table = query.match(/FROM\s+(\w+)/i)?.[1];
    let rows: RecordRow[] = [];
    switch (table) {
      case 'onboarding': {
        const row = { onboarding_id: 42, handle: 'raycast', brand_user_id: 'brand', status: state.status, ingestion_run_id: 'ingestion-1',
          twin_run_id: ['queued', 'scraping'].includes(state.status) ? '' : 'twins-1', owner_name: '', role: '', campaign_name: '', campaign_news: '', goal: '', error: state.error };
        rows = query.includes('WHERE handle') ? [{ ...row, onboarding_id: 41 }, row] : [row]; state.polls++; break;
      }
      case 'x_ingestion_run': rows = [{ followers_discovered: 300, posts_saved: 900 }]; break;
      case 'twin_build_run': rows = [{ requested: 60, ready: state.ready, failed: 0 }]; break;
      case 'audience_membership': rows = users.slice(1).map(user => ({ follower_user_id: user.user_id })); break;
      case 'x_user': rows = query.includes("WHERE user_id = 'brand'") ? users.slice(0, 1) : users; break;
      case 'niche': rows = [{ slug: 'builders', label: 'Builders' }]; break;
      case 'twin': rows = users.slice(1).map(user => ({ user_id: user.user_id, username: user.username, post_count: 3, engagement_rate: .1, reply_share: .2, tone: 'friendly', persona_summary: 'Builder', hot_buttons: [] })); break;
      case 'twin_niche': rows = users.slice(1).map(user => ({ user_id: user.user_id, niche: 'builders', affinity: .9 })); break;
      case 'twin_audience': rows = users.slice(1).map(user => ({ brand_user_id: 'brand', user_id: user.user_id })); break;
      case 'x_post': case 'x_post_entity': case 'ops_hidden': case 'sim_settings': break;
      default: throw new Error(`Unexpected SQL: ${query}`);
    }
    await route.fulfill({ json: wire(rows) });
  });
  return state;
}
async function connect(page: Page) {
  await page.goto('/onboarding');
  await page.getByRole('textbox', { name: 'Your brand on X' }).fill('@Raycast');
  await page.getByRole('textbox', { name: 'Your brand on X' }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Who are you?' })).toBeVisible();
}
async function answerBrief(page: Page) {
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Alex');
  await page.getByRole('textbox', { name: 'Role', exact: true }).fill('Social lead');
  await page.getByRole('textbox', { name: 'Role', exact: true }).press('Enter');
  await page.getByRole('textbox', { name: 'Campaign name' }).fill('Local AI launch');
  await page.getByRole('textbox', { name: 'The news' }).fill('AI on your Mac');
  await page.getByRole('textbox', { name: 'The news' }).press('Enter');
  await expect(page.getByRole('heading', { name: 'What matters most?' })).toBeVisible();
  await page.keyboard.press('a');
  await expect(page.getByRole('button', { name: 'A Reposts' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Build stages' })).toBeVisible();
}

test('handle and Enter request onboarding and advance with live status', async ({ page }) => {
  const state = await mockDatabase(page);
  await connect(page);
  expect(state.calls).toEqual([{ name: 'request_onboarding', args: ['raycast'] }]);
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toBeFocused();
  await expect(page.getByRole('status')).toHaveText('Reading followers');
  await expect(page.getByRole('img', { name: 'Building your audience' })).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');
  await expect(page.locator('.on-group')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: '/tmp/ripple-onboarding-desktop.png', fullPage: true });
});

test('chat onboarding link watches the existing company build without queuing another', async ({ page }) => {
  const state = await mockDatabase(page);
  await page.goto('/onboarding?brand=raycast');
  await expect(page.getByRole('list', { name: 'Build stages' })).toBeVisible();
  expect(state.calls).toEqual([]);
  state.status = 'ready';
  await expect(page.getByRole('button', { name: 'See your audience' })).toBeEnabled();
  await page.getByRole('button', { name: 'See your audience' }).click();
  await expect(page).toHaveURL(/\/dashboard\?brand=raycast$/);
});

test('invalid handles display the reducer error without advancing', async ({ page }) => {
  const state = await mockDatabase(page); state.reducerError = 'enter a valid X handle';
  await page.goto('/onboarding');
  await page.getByRole('textbox').fill('bad handle'); await page.getByRole('textbox').press('Enter');
  await expect(page.getByRole('alert')).toHaveText('enter a valid X handle');
  await expect(page.getByRole('heading', { name: 'Your brand on X' })).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
});

test('brief answers use the newest onboarding ID and ordered reducer arguments', async ({ page }) => {
  const state = await mockDatabase(page);
  await connect(page); await answerBrief(page);
  expect(state.calls[1]).toEqual({ name: 'update_onboarding_brief', args: [42, 'Alex', 'Social lead', 'Local AI launch', 'AI on your Mac', 'reposts'] });
  await expect(page.getByRole('button', { name: 'See your audience' })).toBeDisabled();
});

test('live build lights the stages and hands the new X brand to its audience graph', async ({ page }) => {
  const state = await mockDatabase(page);
  await connect(page); await answerBrief(page);
  const stages = page.getByRole('list', { name: 'Build stages' }).getByRole('listitem');
  const avatar = page.locator('.on-build .on-avatar');
  await expect(avatar.getByRole('img', { name: 'Ripple assistant, working' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Building your audience' })).toBeVisible();
  await expect(page.locator('.on-sheet')).not.toContainText(/\b(300|60)\b/);
  await expect(stages.nth(0)).toHaveAttribute('data-complete', 'false');
  await expect(stages.nth(0).getByRole('img', { name: 'Building your audience' })).toBeVisible();
  await expect(page.locator('.on-build-agent').getByRole('img', { name: 'Building your audience' })).toHaveCount(0);
  const orb = await stages.nth(0).locator('.on-stage-loading').boundingBox();
  const label = await stages.nth(0).locator('>span').nth(1).boundingBox();
  expect(orb!.x).toBeGreaterThan(label!.x + label!.width);
  await expect(page.locator('.on-avatars img')).toHaveCount(24);
  state.status = 'twins'; state.ready = 34;
  await expect(stages.nth(0)).toHaveAttribute('data-complete', 'true');
  await expect(stages.nth(0).getByRole('img')).toHaveCount(0);
  await expect(stages.nth(1).getByRole('img', { name: 'Building your audience' })).toBeVisible();
  await expect(stages.nth(1)).toHaveText('Analyzing your audience'); await expect(avatar).toHaveAttribute('data-state', 'working');
  await expect(page.locator('.on-sheet')).not.toContainText(/\b(300|34|60)\b/);
  state.status = 'graph'; state.ready = 60;
  await expect(stages.nth(1)).toHaveAttribute('data-complete', 'true'); await expect(avatar).toHaveAttribute('data-state', 'working');
  await expect(stages.nth(2)).toContainText('Audience map');
  await expect(stages.nth(2).getByRole('img', { name: 'Building your audience' })).toBeVisible();
  state.status = 'ready';
  await expect(stages.nth(2)).toHaveAttribute('data-complete', 'true'); await expect(avatar).toHaveAttribute('data-state', 'default');
  await expect(page.getByRole('img', { name: 'Building your audience' })).toHaveCount(0);
  await page.getByRole('button', { name: 'See your audience' }).click();
  await expect(page).toHaveURL(/\/dashboard\?brand=raycast$/);
  await expect(page.getByRole('navigation', { name: 'Brand audience' }).getByRole('link', { name: '@raycast X', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('canvas[data-node-count]')).toHaveAttribute('data-node-count', '30');
});

test('failed builds decode the optional error, stop polling, and allow retry', async ({ page }) => {
  const state = await mockDatabase(page);
  await connect(page); await answerBrief(page);
  state.status = 'failed'; state.error = 'Could not read followers. Try again.';
  await expect(page.getByRole('alert')).toHaveText(state.error);
  await expect(page.getByRole('img', { name: 'Building your audience' })).toHaveCount(0);
  const polls = state.polls; await page.waitForTimeout(1700); expect(state.polls).toBe(polls);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your brand on X' })).toBeVisible();
});

test('mobile layout, required validation, back navigation, and Shift+Enter', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  const state = await mockDatabase(page);
  await page.goto('/onboarding'); await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
  await connect(page); await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Alex');
  await page.getByRole('button', { name: 'Previous group' }).click();
  await expect(page.getByRole('textbox', { name: 'Your brand on X' })).toHaveValue('raycast');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Alex'); expect(state.calls).toHaveLength(1);
  await page.getByRole('textbox', { name: 'Name', exact: true }).press('Enter');
  await page.getByRole('textbox', { name: 'Campaign name' }).fill('Launch');
  await page.getByRole('textbox', { name: 'The news' }).fill('First line');
  await page.getByRole('textbox', { name: 'The news' }).press('Shift+Enter');
  await expect(page.getByRole('textbox', { name: 'The news' })).toHaveValue('First line\n');
  await expect(page.getByRole('heading', { name: 'What are you launching?' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/ripple-onboarding-mobile.png', fullPage: true });
});

test('brief reducer errors stay inline and preserve the selected goal for retry', async ({ page }) => {
  const state = await mockDatabase(page); state.briefError = 'not your onboarding';
  await connect(page);
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Alex');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('textbox', { name: 'Campaign name' }).fill('Launch');
  await page.getByRole('textbox', { name: 'The news' }).fill('New launch');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'What matters most?' })).toBeVisible();
  await page.keyboard.press('b'); await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('alert')).toHaveText('not your onboarding');
  await expect(page.getByRole('button', { name: 'B Likes' })).toHaveAttribute('aria-pressed', 'true');
  state.briefError = ''; await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('list', { name: 'Build stages' })).toBeVisible();
  expect(state.calls.at(-1)?.args).toEqual([42, 'Alex', '', 'Launch', 'New launch', 'likes']);
});

test('onboarding inherits the app theme, switches palettes, and persists on reload', async ({ page }) => {
  await mockDatabase(page);
  await page.addInitScript(() => { if (!localStorage.getItem('ripple-theme')) localStorage.setItem('ripple-theme', 'light'); });
  await page.goto('/onboarding');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.on-page')).toHaveCSS('background-color', 'rgb(248, 247, 243)');
  await expect(page.locator('.on-page')).toHaveCSS('font-family', '"DM Sans", sans-serif');
  await page.getByRole('textbox').fill('raycast');
  await expect(page.getByRole('button', { name: 'Continue' })).toHaveCSS('background-color', 'rgb(128, 83, 34)');
  await expect(page.locator('.on-group')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: '/tmp/ripple-onboarding-light.png', fullPage: true });
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('.on-page')).toHaveCSS('background-color', 'rgb(8, 8, 8)');
  await expect(page.getByRole('button', { name: 'Continue' })).toHaveCSS('background-color', 'rgb(230, 188, 136)');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();
});

test('new campaign skips the brief questions and starts its real build', async ({ page }) => {
  const state = await mockDatabase(page);
  await page.goto('/onboarding?flow=campaign');
  await expect(page.getByRole('heading', { name: 'New campaign', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Your brand on X' }).fill('@Raycast');
  await page.getByRole('textbox', { name: 'Campaign name' }).fill('Launch day');
  await page.getByRole('button', { name: 'Build audience' }).click();
  await expect(page.getByRole('list', { name: 'Build stages' })).toBeVisible();
  await expect(page).toHaveURL('/onboarding?flow=campaign&build=42');
  expect(state.calls).toEqual([
    { name: 'request_onboarding', args: ['raycast'] },
    { name: 'update_onboarding_brief', args: [42, '', '', 'Launch day', '', 'reposts'] },
  ]);
  await expect(page.getByText('Analyzing your audience', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Who are you?' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Back to campaigns' })).toHaveAttribute('href', '/home');
  state.status = 'ready';
  await expect(page.getByRole('button', { name: 'See your audience' })).toBeEnabled({ timeout: 10000 });
});

test('campaign build URL resumes on reload and failed builds can restart', async ({ page }) => {
  const state = await mockDatabase(page); state.status = 'twins';
  await page.goto('/onboarding?flow=campaign&build=42');
  await expect(page.getByRole('list', { name: 'Build stages' })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('list', { name: 'Build stages' })).toBeVisible();
  state.status = 'failed'; state.error = 'Could not read this account';
  await expect(page.getByText('Could not read this account')).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page).toHaveURL('/onboarding?flow=campaign');
  await expect(page.getByRole('textbox', { name: 'Your brand on X' })).toBeVisible();
});
