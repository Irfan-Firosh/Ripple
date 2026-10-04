import { expect, test, type Page } from '@playwright/test';

type Row = Record<string, unknown>;
function wire(rows: Row[]) {
  const keys = Object.keys(rows[0] ?? {});
  return [{ schema: { elements: keys.map(name => ({ name: { some: name }, algebraic_type: { String: {} } })) }, rows: rows.map(row => keys.map(key => row[key])) }];
}
async function database(page: Page) {
  const state = { people: 3, historyError: false };
  const brand = { user_id: 'brand', username: 'raycast', name: 'Raycast', profile_image_url: '', followers_count: 300 };
  const old = { brand: { userId: 'old', username: 'oldbrand', name: 'Previous audience', avatar: '', platform: 'x' },
    members: Array.from({ length: 2 }, (_, i) => ({ userId: `old-${i}`, username: `old${i}`, name: `Old ${i}`, avatar: '', followers: 12, profileUrl: `https://x.com/old${i}`, postCount: 4, engagementRate: .1, replyShare: .1, tone: '', personaSummary: 'An archived builder', hotButtons: [], niches: [{ slug: i ? 'design' : 'builders', label: i ? 'Design' : 'Builders', affinity: .9 }], primaryNiche: i ? 'design' : 'builders' })),
    niches: [{ slug: 'builders', label: 'Builders' }, { slug: 'design', label: 'Design' }], links: [['old-0', 'old-1'], ['old-1', 'old-0']] };
  await page.route('https://maincloud.spacetimedb.com/**', async route => {
    const query = route.request().postData() ?? '', table = query.match(/FROM\s+(\w+)/i)?.[1];
    let rows: Row[] = [];
    switch (table) {
      case 'x_user': rows = [brand, ...Array.from({ length: state.people }, (_, i) => ({ user_id: `person-${i}`, username: `person${i}`, name: `Person ${i}`, profile_image_url: '', followers_count: 5, post_count: 12 }))]; break;
      case 'audience_membership': rows = Array.from({ length: state.people }, (_, i) => ({ brand_user_id: 'brand', follower_user_id: `person-${i}` })); break;
      case 'niche': rows = [{ slug: 'builders', label: 'Builders' }]; break;
      case 'twin': rows = [{ user_id: 'person-0', username: 'person0', post_count: 10, engagement_rate: .1, reply_share: .1, tone: '', persona_summary: 'Builds tools', hot_buttons: [] }]; break;
      case 'twin_niche': rows = [{ user_id: 'person-0', niche: 'builders', affinity: .9 }]; break;
      case 'twin_audience': rows = [{ brand_user_id: 'brand', user_id: 'person-0' }]; break;
      case 'x_post': rows = [{ post_id: 'p', author_user_id: 'person-0', in_reply_to_user_id: 'person-1' }]; break;
      case 'x_post_entity': case 'lab_draft_media': case 'campaign_flow': case 'campaign_video': case 'ad_variant': break;
      case 'archived_profile': rows = [{ user_id: 'old', username: 'oldbrand', name: 'Previous audience', profile_image_url: '', verified: false }]; break;
      case 'audience_snapshot':
        if (state.historyError) return route.fulfill({ status: 503 });
        rows = query.includes('SELECT payload') ? [{ payload: JSON.stringify(old) }] : [{ snapshot_id: 'saved-1', brand: 'oldbrand', title: 'Previous audience', people: 2, niches: 2, created_at: 1791000000000000 }, { snapshot_id: 'empty-1', brand: 'emptybrand', title: 'Empty company', people: 0, niches: 0, created_at: 1791200000000000 }]; break;
      case 'lab_experiment': rows = [
        { experiment_id: 4, brand: 'oldbrand', title: 'Earlier launch', status: 'done', winner: 'B', lift: .12, created_at: 1791000000000000, draft_a: 'Draft A content', draft_b: 'Draft B content', error: null, run_a: 'run-a', run_b: 'run-b' },
        { experiment_id: 5, brand: 'raycast', title: 'New campaign', status: 'failed', winner: '', lift: 0, created_at: 1791100000000000, draft_a: 'A', draft_b: 'B', error: 'Failed', run_a: '', run_b: '' },
        { experiment_id: 6, brand: 'emptybrand', title: 'Empty company experiment', status: 'failed', winner: '', lift: 0, created_at: 1791200000000000, draft_a: 'A', draft_b: 'B', error: 'No audience', run_a: '', run_b: '' },
      ].filter(r => query.includes('WHERE experiment_id') ? query.endsWith(String(r.experiment_id)) : query.includes('WHERE brand') ? query.includes(`'${r.brand}'`) : true); break;
      case 'sim_run': rows = [{ run_id: query.includes('run-a') ? 'run-a' : 'run-b', status: 'done', replay_tick: 0, replay_max_tick: 0, people: 2 }]; break;
      case 'sim_signal': rows = ['like', 'repost', 'reply', 'quote'].map(signal => ({ signal, p_10: 1, p_50: 2, p_90: 3, mean: 2 })); break;
      case 'sim_event': case 'sim_node_signal': case 'sim_outside_tick': case 'sim_comment': case 'sim_signal_source': case 'ops_hidden': case 'ops_state': case 'sim_projection': break;
      default: throw new Error(`Unexpected request: ${query}`);
    }
    await route.fulfill({ json: wire(rows) });
  });
  return state;
}

test('audience is fully visible in 3D without a source node, post edges, or cascade controls', async ({ page }) => {
  await database(page); await page.goto('/dashboard?brand=raycast&view=2d');
  const canvas = page.getByRole('img', { name: /Three-dimensional audience network/ });
  await expect(page.getByRole('region', { name: 'Network visualization' })).toHaveAttribute('aria-busy', 'false');
  await expect(canvas).toHaveAttribute('data-view', '3d');
  await expect(canvas).toHaveAttribute('data-node-count', '3');
  await expect(canvas).toHaveAttribute('data-active-count', '3');
  await expect(canvas).toHaveAttribute('data-complete', 'true');
  await expect(canvas).toHaveAttribute('data-source-node-count', '0');
  await expect(canvas).toHaveAttribute('data-sprite-count', '3');
  await expect(canvas).toHaveAttribute('data-post-edge-count', '0');
  await expect(canvas).toHaveAttribute('data-bridge-edge-count', '1');
  await expect(page.getByText('Thicker links = more connections · drag to orbit · scroll to zoom')).toBeVisible();
  await page.screenshot({ path: '/tmp/ripple-audience-connectivity-dark.png' });
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(canvas).toHaveAttribute('data-bridge-edge-count', '1');
  await page.screenshot({ path: '/tmp/ripple-audience-connectivity-light.png' });
  await expect(page.getByRole('group', { name: 'Network dimension' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Replay|Pause cascade|Play cascade/ })).toHaveCount(0);
  await expect(page.getByLabel('Niche index')).toContainText('Building profiles');
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(async () => Number(await canvas.getAttribute('data-camera-zoom'))).toBeGreaterThan(1);
});

test('Scweet profiles appear live before their twins are ready', async ({ page }) => {
  const state = await database(page); await page.goto('/dashboard?brand=raycast');
  const canvas = page.getByRole('img', { name: /Three-dimensional audience network/ });
  await expect(canvas).toHaveAttribute('data-node-count', '3'); state.people = 4;
  await expect(canvas).toHaveAttribute('data-node-count', '4', { timeout: 10000 });
  await expect(canvas).toHaveAttribute('data-active-count', '4');
});

test('history searches, switches sections, and opens an immutable audience version', async ({ page }) => {
  await database(page); await page.goto('/dashboard?brand=raycast');
  await page.getByRole('button', { name: 'Open history' }).click();
  const dialog = page.getByRole('dialog', { name: 'History' });
  await expect(dialog.getByRole('textbox', { name: 'Search history' })).toBeFocused();
  await expect(dialog.getByText('Previous audience')).toBeVisible();
  await expect(dialog.getByText('Empty company', { exact: true })).toHaveCount(0);
  await dialog.getByRole('tab', { name: 'Lab experiments' }).click();
  await expect(dialog.getByText('New campaign')).toBeVisible();
  await expect(dialog.getByText('Empty company experiment', { exact: true })).toHaveCount(0);
  await dialog.getByRole('textbox').fill('earlier');
  await expect(dialog.getByText('Earlier launch')).toBeVisible(); await expect(dialog.getByText('New campaign')).toHaveCount(0);
  await dialog.getByRole('tab', { name: 'Audience maps' }).click();
  await dialog.getByRole('button', { name: /Previous audience/ }).click();
  await expect(page).toHaveURL(/brand=oldbrand&snapshot=saved-1/);
  await expect(page.getByRole('img', { name: /Three-dimensional audience network/ })).toHaveAttribute('data-node-count', '2');
  await expect(page.getByRole('img', { name: /Three-dimensional audience network/ })).toHaveAttribute('data-bridge-edge-count', '1');
  await expect(page.getByRole('link', { name: 'Live audience', exact: true })).toHaveAttribute('href', '/dashboard?brand=oldbrand');
});

test('Lab history opens previous results even after their active profiles are removed', async ({ page }) => {
  await database(page); await page.goto('/lab?brand=raycast&exp=5');
  await page.getByRole('button', { name: 'Open history' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Earlier launch/ }).click();
  await expect(page).toHaveURL(/brand=oldbrand&exp=4/);
  await expect(page.locator('.lab-columns')).toContainText('Draft A content');
  await expect(page.locator('.lab-columns')).toContainText('Previous audience');
  await expect(page.locator('.lab-verdict')).toContainText('B wins');
});

test('mobile history fits, supports Escape, and recovers from read errors', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  const state = await database(page); state.historyError = true;
  let releaseAudience = () => {};
  const audienceRead = new Promise<void>(resolve => { releaseAudience = resolve; });
  await page.route('**/v1/database/ripple-mhacks/sql', async route => {
    if (/FROM x_post\b/.test(route.request().postData() ?? '')) await audienceRead;
    await route.fallback();
  });
  await page.goto('/dashboard?brand=raycast'); await page.getByRole('button', { name: 'Open history' }).click();
  const dialog = page.getByRole('dialog'); await expect(dialog.getByRole('alert')).toBeVisible();
  state.historyError = false; await dialog.getByRole('button', { name: 'Try again' }).click();
  await expect(dialog.getByText('Previous audience')).toBeVisible();
  await dialog.getByLabel('Search history').focus(); releaseAudience();
  await expect(page.getByRole('img', { name: /Three-dimensional audience network/ })).toHaveAttribute('data-complete', 'true');
  await expect(dialog.getByLabel('Search history')).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/ripple-history-mobile.png' });
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open history' })).toBeFocused();
});

test('visual playground graph has no intercluster edges', async ({ page }) => {
  await page.goto('/visuals');
  const canvas = page.locator('.network-canvas');
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute('data-bridge-edge-count', '0');
  await expect(page.locator('.scene-legend .bridge-key')).toHaveCount(0);
});
