import { test, expect, type Page } from '@playwright/test';

type Row = Record<string, unknown>;
const wire = (rows: Row[]) => {
  const keys = Object.keys(rows[0] ?? {});
  return [{ schema: { elements: keys.map(name => ({ name: { some: name }, algebraic_type: { String: {} } })) }, rows: rows.map(row => keys.map(key => row[key])) }];
};
async function database(page: Page, brand = 'raycast') {
  const state = { requested: false, error: '', audienceError: false, calls: [] as unknown[][] };
  const original = { experiment_id: 10, brand, title: 'Launch', status: 'done', winner: 'B', lift: .2, created_at: 1791100000000000, draft_a: 'New product.\n\nTry it.', draft_b: 'Ship fast.', error: null, run_a: 'run-a', run_b: 'run-b' };
  await page.route('https://maincloud.spacetimedb.com/**', route => {
    const request = route.request();
    if (request.url().endsWith('/identity')) return route.fulfill({ json: { token: 'test-only-token' } });
    if (request.url().includes('/call/request_lab_experiment')) {
      state.calls.push(request.postDataJSON() as unknown[]);
      if (state.error) return route.fulfill({ status: 400, body: `SenderError: ${state.error}` });
      state.requested = true; return route.fulfill({ status: 200, body: '' });
    }
    const query = request.postData() ?? '', table = query.match(/FROM\s+(\w+)/i)?.[1];
    let rows: Row[] = [];
    switch (table) {
      case 'lab_experiment': rows = [original, ...(state.requested ? [{ ...original, experiment_id: 11, status: 'queued', winner: '', run_a: '', run_b: '', created_at: 1791200000000000 }] : [])].filter(row => !query.includes('WHERE experiment_id') || query.endsWith(String(row.experiment_id))); break;
      case 'x_user': rows = [{ user_id: 'brand', username: brand, name: brand === 'raycast' ? 'Raycast' : brand, profile_image_url: '/login-dark.png', verified: false }, ...['tess', 'lee', 'sam'].map(user => ({ user_id: user, username: user, name: user, profile_image_url: '' }))]; break;
      case 'audience_membership': rows = ['tess', 'lee', 'sam'].map(user => ({ brand_user_id: 'brand', follower_user_id: user })); break;
      case 'niche':
        if (state.audienceError) return route.fulfill({ status: 503, body: 'Unavailable' });
        rows = ['ai', 'product', 'design'].map(slug => ({ slug, label: slug })); break;
      case 'twin': rows = ['tess', 'lee', 'sam'].map(user => ({ user_id: user, username: user, post_count: 12, engagement_rate: .1, reply_share: .2, tone: '', persona_summary: '', hot_buttons: [] })); break;
      case 'twin_niche': rows = ['tess', 'lee', 'sam'].flatMap((user, i) => [{ user_id: user, niche: ['ai', 'product', 'design'][i], affinity: .9 }, { user_id: user, niche: ['ai', 'product', 'design'][(i + 1) % 3], affinity: .5 }]); break;
      case 'twin_audience': rows = ['tess', 'lee', 'sam'].map(user => ({ brand_user_id: 'brand', user_id: user })); break;
      case 'x_post': case 'x_post_entity': break;
      case 'sim_run': rows = [{ run_id: 'run', brand_user_id: 'brand', status: 'done', replay_tick: 0, replay_max_tick: 0, people: 30 }]; break;
      case 'sim_signal': rows = ['like', 'repost', 'reply', 'quote', 'view'].map((signal, i) => ({ signal, p_10: i + 1, p_50: i + 3, p_90: i + 5, mean: i + 3 })); break;
      case 'sim_event': rows = [{ user_id: 'tess', signal: 'like', tick: 0 }, { user_id: 'lee', signal: 'repost', tick: 0 }, { user_id: 'sam', signal: 'quote', tick: 0 }]; break;
      case 'sim_comment': rows = [{ user_id: 'tess', kind: 'reply', text: 'Love the launch.', tick: 0 }, { user_id: 'sam', kind: 'quote', text: 'Worth sharing.', tick: 0 }]; break;
      case 'lab_draft_media': rows = [{ video_id: 'video-10' }]; break;
      case 'campaign_video': rows = [{ video_url: '/videos/ripple-demo-dark.mp4', thumbnail_url: '/login-dark.png', title: 'Launch video', status: 'done' }]; break;
      case 'sim_projection': rows = [{ brand: 'raycast', mode: 'linear', audience: 22632, simulated: 60, factor: 377.2 }]; break;
      case 'campaign_flow': case 'sim_node_signal': case 'sim_signal_source': case 'sim_outside_tick': case 'archived_profile': case 'audience_snapshot': case 'ops_state': case 'ops_hidden': case 'demo_settings': case 'landing_settings': break;
      default: throw new Error(`Unexpected SQL: ${query}`);
    }
    return route.fulfill({ json: wire(rows) });
  });
  return state;
}

test('simulation has browsable reactions and minimal side-by-side audience graphs', async ({ page }) => {
  const state = await database(page); await page.goto('/lab?brand=raycast&exp=10');
  await expect(page).toHaveTitle('Ripple');
  const draft = page.getByRole('region', { name: 'Draft A reactions' });
  await expect(draft.getByText('Love the launch.')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('body')).not.toContainText('Projected to');
  await draft.getByRole('tab', { name: 'Likes', exact: true }).click();
  await expect(draft.getByRole('article', { name: 'tess liked draft A' })).toBeVisible();
  await expect(draft.getByText('Love the launch.')).toHaveCount(0);
  await draft.getByRole('tab', { name: 'Reposts', exact: true }).click();
  await expect(draft.getByRole('article', { name: 'lee reposted draft A' })).toBeVisible();
  await expect(draft.getByText('Worth sharing.')).toBeVisible();
  await page.getByRole('article', { name: 'Draft A', exact: true }).locator('[data-metric="replies"]').click();
  await expect(draft.getByText('Love the launch.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Replay', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Analysis' }).click();
  const dialog = page.getByRole('dialog', { name: 'Analysis' });
  const spread = dialog.getByRole('region', { name: 'Audience spread comparison' });
  await expect(spread.getByRole('figure')).toHaveCount(2);
  const a = dialog.getByRole('img', { name: 'Draft A @raycast audience spread' });
  await expect(a).toHaveAttribute('data-total', '3');
  await expect(dialog.getByRole('img', { name: 'Draft B @raycast audience spread' })).toBeVisible();
  await expect(spread.locator('figcaption')).toHaveText(['A', 'B']);
  await expect(dialog.getByAltText('@raycast logo')).toHaveCount(2);
  await expect(dialog.locator('.spread-person')).toHaveCount(6);
  await expect(dialog.locator('.spread-share, .spread-niche-legend, .spread-audience-meta')).toHaveCount(0);
  await expect(spread).not.toContainText(/\d+%|proportional sample|TryCua|Follow the ripple/);
  const timeline = dialog.getByRole('region', { name: 'Engagement over time' });
  await expect(timeline.getByRole('figure')).toHaveCount(2);
  await expect(timeline.getByRole('table')).toHaveCount(2);
  await expect(timeline.getByRole('table').first().getByRole('columnheader')).toHaveText(['Time', 'Likes', 'Reposts', 'Replies', 'Quotes', 'Views']);
  await expect(dialog).toContainText('Illustrative spread');
  await expect(dialog.locator('.spread-popup[data-action=repost]').first()).toBeVisible({ timeout: 10000 });
  await expect(dialog.locator('.spread-popup').first()).toContainText('Reposted');
  await expect(spread.locator('.spread-popup')).toHaveCount(1);
  await expect(dialog.locator('.spread-popup').first().locator('a')).toHaveAttribute('href', /https:\/\/x\.com\/(tess|lee|sam)/);
  await dialog.getByRole('button', { name: 'Pause audience animation' }).click();
  const time = await a.getAttribute('data-time'); await page.waitForTimeout(250);
  await expect(a).toHaveAttribute('data-time', time!);
  await dialog.getByRole('button', { name: 'Restart audience animation' }).click();
  await expect.poll(async () => Number(await a.getAttribute('data-time'))).toBeLessThan(1);
  const firstNotice = dialog.locator('.lab-spread-graph').filter({ has: page.locator('.spread-popup') });
  await expect(firstNotice).toHaveCount(1, { timeout: 10000 });
  const firstSide = (await firstNotice.getAttribute('class'))!.includes('spread-A') ? 'A' : 'B';
  const otherSide = firstSide === 'A' ? 'B' : 'A';
  await expect(dialog.locator(`.lab-spread-graph.spread-${otherSide} .spread-popup`)).toBeVisible({ timeout: 12000 });
  await page.waitForTimeout(250);
  const desktop = await dialog.boundingBox(); expect(desktop!.width).toBeGreaterThan(1000);
  await expectPopupGutters(dialog);
  expect(state.calls).toEqual([]);
  await expect(dialog.getByText('B wins · +20% expected engagement')).toHaveCount(0);
  await page.screenshot({ path: '/tmp/ripple-lab-analysis-black.png', fullPage: true });
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Analysis' })).toBeFocused();
  await expect(page.locator('.lab-page')).toHaveCSS('background-color', 'rgb(8, 8, 8)');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Analysis' }).click();
  await expect(dialog.getByRole('img', { name: 'Draft A @raycast audience spread' })).toBeVisible();
  await expect(dialog.getByRole('img', { name: 'Draft B @raycast audience spread' })).toBeVisible();
  await expect(dialog.locator('.spread-popup').first()).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(250); await expectPopupGutters(dialog);
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/ripple-lab-analysis-mobile.png', fullPage: true });
});

async function expectPopupGutters(dialog: import('@playwright/test').Locator) {
  const gaps = await dialog.locator('.spread-popup').first().evaluate(popup => {
    const p = popup.getBoundingClientRect(), s = popup.closest('.spread-stage')!.getBoundingClientRect();
    return [p.left - s.left, s.right - p.right, p.top - s.top, s.bottom - p.bottom];
  });
  for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(12);
}

test('analysis handles unavailable audiences, retry and reduced motion without starting a simulation', async ({ page }) => {
  const state = await database(page); state.audienceError = true;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/lab?brand=raycast&exp=10');
  await page.getByRole('button', { name: 'Analysis' }).click();
  const dialog = page.getByRole('dialog', { name: 'Analysis' });
  await expect(dialog.getByRole('alert')).toContainText('Audience unavailable.');
  state.audienceError = false; await dialog.getByRole('button', { name: 'Try again' }).click();
  const a = dialog.getByRole('img', { name: 'Draft A @raycast audience spread' });
  await expect(a).toHaveAttribute('data-motion', 'still');
  await expect.poll(async () => Number(await a.getAttribute('data-time'))).toBeGreaterThan(0);
  const time = await a.getAttribute('data-time'); await page.waitForTimeout(250);
  await expect(a).toHaveAttribute('data-time', time!);
  await expect(dialog.getByRole('button', { name: 'Pause audience animation' })).toHaveCount(0);
  await expect(dialog.locator('.spread-popup')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Restart audience animation' }).click();
  await expect(a).toHaveAttribute('data-time', time!);
  expect(state.calls).toEqual([]);
});

test('new brand campaigns use their own audience in a fresh light-mode session', async ({ page }) => {
  const state = await database(page, 'northstar');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/lab?brand=northstar&exp=10');
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await page.getByRole('button', { name: 'Analysis' }).click();
  const dialog = page.getByRole('dialog', { name: 'Analysis' });
  await expect(dialog.getByRole('img', { name: 'Draft A @northstar audience spread' })).toHaveAttribute('data-total', '3');
  await expect(dialog.getByRole('img', { name: 'Draft B @northstar audience spread' })).toBeVisible();
  await expect(dialog.getByAltText('@northstar logo')).toHaveCount(2);
  await expect(dialog.getByRole('table')).toHaveCount(2);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(state.calls).toEqual([]);
});

test('resimulate submits the same drafts and opens a new real experiment with its media source', async ({ page }) => {
  const state = await database(page); await page.goto('/lab?brand=raycast&exp=10');
  await page.getByRole('button', { name: 'Resimulate', exact: true }).click();
  await expect(page).toHaveURL('/lab?brand=raycast&exp=11&source=10');
  expect(state.calls).toEqual([['raycast', 'Launch', 'New product.\n\nTry it.', 'Ship fast.']]);
  await expect(page.getByText('Queued — waiting for the simulator…')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resimulate', exact: true })).toBeDisabled();
  // Nothing is shown until the results are final: a loading state, no live drafts or zero counts.
  await expect(page.getByText('Simulating your audience…')).toBeVisible();
  await expect(page.getByRole('article', { name: 'Draft A', exact: true })).toHaveCount(0);
  await page.evaluate(() => localStorage.removeItem('ripple-lab-media-source:11'));
  await page.reload(); await expect(page).toHaveURL('/lab?brand=raycast&exp=11&source=10');
});

test('resimulation rejection preserves the current experiment and drafts', async ({ page }) => {
  const state = await database(page); state.error = 'at most 2 experiments can run at once';
  await page.goto('/lab?brand=raycast&exp=10');
  await page.getByRole('button', { name: 'Resimulate', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(state.error);
  await expect(page).toHaveURL('/lab?brand=raycast&exp=10');
  await expect(page.getByRole('article', { name: 'Draft A', exact: true })).toContainText('New product.');
  expect(state.calls).toHaveLength(1);
});
