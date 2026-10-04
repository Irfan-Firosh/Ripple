import { test, expect, type Page } from '@playwright/test';

type Row = Record<string, unknown>;
const wire = (rows: Row[]) => {
  const keys = Object.keys(rows[0] ?? {});
  return [{ schema: { elements: keys.map(name => ({ name: { some: name }, algebraic_type: { String: {} } })) }, rows: rows.map(row => keys.map(key => row[key])) }];
};
async function database(page: Page) {
  const state = { requested: false, error: '', calls: [] as unknown[][] };
  const original = { experiment_id: 10, brand: 'raycast', title: 'Launch', status: 'done', winner: 'B', lift: .2, created_at: 1791100000000000, draft_a: 'New product.\n\nTry it.', draft_b: 'Ship fast.', error: null, run_a: 'run-a', run_b: 'run-b' };
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
      case 'x_user': rows = [{ user_id: 'brand', username: 'raycast', name: 'Raycast', profile_image_url: '', verified: false }, ...['tess', 'lee', 'sam'].map(user => ({ user_id: user, username: user, name: user, profile_image_url: '' }))]; break;
      case 'audience_membership': rows = [{ brand_user_id: 'brand', follower_user_id: 'tess' }]; break;
      case 'sim_run': rows = [{ run_id: 'run', status: 'done', replay_tick: 0, replay_max_tick: 0, people: 30 }]; break;
      case 'sim_signal': rows = ['like', 'repost', 'reply', 'quote', 'view'].map((signal, i) => ({ signal, p_10: i + 1, p_50: i + 3, p_90: i + 5, mean: i + 3 })); break;
      case 'sim_event': rows = [{ user_id: 'tess', signal: 'like', tick: 0 }, { user_id: 'lee', signal: 'repost', tick: 0 }, { user_id: 'sam', signal: 'quote', tick: 0 }]; break;
      case 'sim_comment': rows = [{ user_id: 'tess', kind: 'reply', text: 'Love the launch.', tick: 0 }, { user_id: 'sam', kind: 'quote', text: 'Worth sharing.', tick: 0 }]; break;
      case 'lab_draft_media': rows = [{ video_id: 'video-10' }]; break;
      case 'campaign_video': rows = [{ video_url: '/videos/ripple-demo-dark.mp4', thumbnail_url: '/login-dark.png', title: 'Launch video', status: 'done' }]; break;
      case 'campaign_flow': case 'sim_node_signal': case 'sim_signal_source': case 'sim_outside_tick': case 'archived_profile': case 'audience_snapshot': case 'ops_state': case 'ops_hidden': case 'sim_projection': break;
      default: throw new Error(`Unexpected SQL: ${query}`);
    }
    return route.fulfill({ json: wire(rows) });
  });
  return state;
}

test('simulation has browsable likes, reposts and comments plus a side-by-side video analysis', async ({ page }) => {
  await database(page); await page.goto('/lab?brand=raycast&exp=10');
  const draft = page.getByRole('region', { name: 'Draft A reactions' });
  await expect(draft.getByText('Love the launch.')).toBeVisible();
  await draft.getByRole('tab', { name: 'Likes', exact: true }).click();
  await expect(draft.getByRole('article', { name: 'tess liked draft A' })).toBeVisible();
  await expect(draft.getByText('Love the launch.')).toHaveCount(0);
  await draft.getByRole('tab', { name: 'Reposts', exact: true }).click();
  await expect(draft.getByRole('article', { name: 'lee reposted draft A' })).toBeVisible();
  await expect(draft.getByText('Worth sharing.')).toBeVisible();
  await page.getByRole('article', { name: 'Draft A', exact: true }).locator('[data-metric="replies"]').click();
  await expect(draft.getByText('Love the launch.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Replay', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Side-by-side analysis' }).click();
  const dialog = page.getByRole('dialog', { name: 'Side-by-side analysis' });
  await expect(dialog.getByRole('figure')).toHaveCount(2); // one chart per draft, nothing else
  await expect(dialog.getByRole('table').first().getByRole('columnheader')).toHaveText(['Time', 'Likes', 'Reposts', 'Replies', 'Quotes', 'Views']);
  await expect(dialog.getByText('B wins · +20% expected engagement')).toHaveCount(0);
  await page.screenshot({ path: '/tmp/ripple-lab-analysis-black.png', fullPage: true });
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Side-by-side analysis' })).toBeFocused();
  await expect(page.locator('.lab-page')).toHaveCSS('background-color', 'rgb(8, 8, 8)');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Side-by-side analysis' }).click();
  await expect(dialog.getByRole('table').first()).toBeVisible();
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/ripple-lab-analysis-mobile.png', fullPage: true });
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
