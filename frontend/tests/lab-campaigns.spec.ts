import { expect, test, type Page } from '@playwright/test';

type Row = Record<string, unknown>;
const owner = 'b'.repeat(64);
const wire = (rows: Row[]) => {
  const keys = Object.keys(rows[0] ?? {});
  return [{ schema: { elements: keys.map(name => ({ name: { some: name }, algebraic_type: { String: {} } })) }, rows: rows.map(row => keys.map(key => row[key])) }];
};
async function setup(page: Page, empty = false) {
  const state = { fail: false, reducers: 0 };
  await page.addInitScript(() => localStorage.setItem('ripple-creative-token:wss://maincloud.spacetimedb.com:ripple-mhacks', 'test-only-token'));
  await page.route('**/src/module_bindings/index.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export const DbConnection = { builder() { let connect; const ctx={disconnect(){}};
      return {withUri(){return this},withDatabaseName(){return this},withToken(){return this},onConnect(fn){connect=fn;return this},onConnectError(){return this},build(){queueMicrotask(()=>connect(ctx,{toHexString:()=> '${owner}'}));return ctx}}; } };
  ` }));
  await page.route('**/src/flow/CampaignFlowPage.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: 'export default function CampaignFlowPage(){return null}' }));
  await page.route('https://maincloud.spacetimedb.com/**', route => {
    const request = route.request();
    if (request.url().includes('/call/')) { state.reducers++; return route.fulfill({ status: 400, body: 'Unexpected inference request' }); }
    const query = request.postData() ?? '', table = query.match(/FROM\s+(\w+)/i)?.[1];
    let rows: Row[] = [];
    if (table === 'campaign_flow') {
      if (query.includes('requested_by')) {
        expect(query).toBe(`SELECT * FROM campaign_flow WHERE requested_by = 0x${owner}`);
        if (state.fail) return route.fulfill({ status: 503, body: 'Unavailable' });
        rows = empty ? [] : [
          { campaign_id: 'launch', brand: 'raycast', source: 'generate', stage: 'testing', draft_a: '', draft_b: '', experiment_id: 20, created_at: 1791200000000000 },
          { campaign_id: 'pending', brand: 'raycast', source: 'import', stage: 'concepts', draft_a: 'A second idea', draft_b: 'Another idea', experiment_id: 0, created_at: 1791100000000000 },
        ];
      }
    } else if (table === 'campaign') rows = query.includes("'launch'") ? [{ name: 'Local launch' }] : [];
    else if (table === 'lab_experiment') rows = [10, 20].map(id => ({ experiment_id: id, brand: 'raycast', title: id === 10 ? 'Previous test' : 'Campaign test', status: 'failed', winner: '', lift: 0, error: 'Not scored', created_at: id, draft_a: 'First draft', draft_b: 'Second draft', run_a: '', run_b: '' })).filter(row => !query.includes('WHERE experiment_id') || query.endsWith(String(row.experiment_id)));
    else if (table === 'x_user') rows = [{ user_id: 'brand', username: 'raycast', name: 'Raycast', profile_image_url: '' }];
    else if (table === 'audience_membership') rows = [{ brand_user_id: 'brand', follower_user_id: 'person' }];
    return route.fulfill({ json: wire(rows) });
  });
  return state;
}

test('Lab selects a specific owned campaign and opens its existing results', async ({ page }) => {
  const state = await setup(page); await page.goto('/lab?brand=raycast&exp=10');
  const dock = page.getByRole('navigation', { name: 'Experiments' });
  await expect(dock).toHaveClass('lab-history');
  const historyBox = (await dock.boundingBox())!, content = (await page.locator('.lab-workspace-content').boundingBox())!;
  expect(historyBox.x + historyBox.width).toBeLessThan(content.x);
  await expect(dock.getByRole('heading', { name: 'History' })).toBeVisible();
  await expect(dock.getByRole('button', { name: /Previous test/ })).toBeVisible();
  await expect(dock.getByRole('button', { name: 'Select campaign' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'New experiment' })).toHaveCount(0);
  await dock.getByRole('button', { name: 'Select campaign' }).click();
  const picker = page.getByRole('dialog', { name: 'Select campaign' });
  await expect(picker.getByRole('button', { name: /Local launch/ })).toBeVisible();
  await picker.getByRole('button', { name: /Local launch/ }).click();
  await expect(page).toHaveURL(/brand=raycast&exp=20/);
  await expect(picker).toHaveCount(0); expect(state.reducers).toBe(0);
  await dock.getByRole('button', { name: /Campaign test/ }).focus();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/exp=10/);
});

test('unfinished campaigns resume their flow and selector fits mobile with keyboard dismissal', async ({ page }) => {
  const state = await setup(page); await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/lab?brand=raycast&exp=10');
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  const opener = page.getByRole('button', { name: 'Select campaign' }); await expect(opener).toBeEnabled(); await opener.click();
  const picker = page.getByRole('dialog', { name: 'Select campaign' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/ripple-lab-campaign-picker-mobile.png', fullPage: true });
  await page.keyboard.press('Escape'); await expect(picker).toHaveCount(0); await expect(opener).toBeFocused();
  await opener.click(); await picker.getByRole('button', { name: /A second idea/ }).click();
  await expect(page).toHaveURL('/campaign?brand=raycast&id=pending'); expect(state.reducers).toBe(0);
});

test('Lab without campaigns routes Create new campaign to the campaign page', async ({ page }) => {
  const state = await setup(page, true); await page.goto('/lab?brand=raycast&exp=10');
  const dock = page.getByRole('navigation', { name: 'Experiments' });
  const action = dock.getByRole('button', { name: 'Create new campaign' }); await expect(action).toBeEnabled(); await action.click();
  await expect(page).toHaveURL('/campaign?brand=raycast'); expect(state.reducers).toBe(0);
});

test('campaign lookup errors offer retry rather than implying an empty workspace', async ({ page }) => {
  const state = await setup(page); state.fail = true; await page.goto('/lab?brand=raycast&exp=10');
  const action = page.getByRole('button', { name: 'Select campaign' }); await expect(action).toBeEnabled(); await action.click();
  const picker = page.getByRole('dialog', { name: 'Select campaign' }); await expect(picker.getByRole('alert')).toContainText('Couldn’t load campaigns.');
  state.fail = false; await picker.getByRole('button', { name: 'Try again' }).click();
  await expect(picker.getByRole('button', { name: /Local launch/ })).toBeVisible(); expect(state.reducers).toBe(0);
});
