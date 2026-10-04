import { expect, test, type Page } from '@playwright/test';

type Row = Record<string, unknown>;
const owner = 'c'.repeat(64);
const wire = (rows: Row[]) => {
  const keys = Object.keys(rows[0] ?? {});
  return [{ schema: { elements: keys.map(name => ({ name: { some: name }, algebraic_type: { String: {} } })) }, rows: rows.map(row => keys.map(key => row[key])) }];
};
async function setup(page: Page) {
  const state = { completed: false, fail: false, calls: 0, reads: 0 };
  await page.addInitScript(() => localStorage.setItem('ripple-creative-token:wss://maincloud.spacetimedb.com:ripple-mhacks', 'test-only-token'));
  await page.route('**/src/module_bindings/index.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export const DbConnection={builder(){let connect;const ctx={disconnect(){}};return {withUri(){return this},withDatabaseName(){return this},withToken(){return this},onConnect(fn){connect=fn;return this},onConnectError(){return this},build(){queueMicrotask(()=>connect(ctx,{toHexString:()=> '${owner}'}));return ctx}}}};
  ` }));
  await page.route('**/src/creative/useCreative.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export function useCreative(brand,id){return {ready:true,audience:[],affinities:[],catalog:[],variants:[],
      campaigns:[{campaignId:'first',name:'Launch one',goal:'Grow developer reach'},{campaignId:'second',name:'Launch two',goal:'Explain the new feature'}],
      briefs:id?[{campaignId:id,messageAngle:id==='first'?'Lead with faster development.':'Show the new shortcut.',audienceLabel:'Developer tools',twinCount:30,share:.6,keyInterests:[{text:'workflow automation'},{text:'developer productivity'}]}]:[],
      jobs:[{campaignId:id,kind:'generate',status:'running'}],run:()=>{throw new Error('Unexpected generation')}};}
  ` }));
  await page.route('**/api/campaign-research?*', route => {
    expect(new URL(route.request().url()).searchParams.get('brand')).toBe('raycast'); state.reads++;
    if (state.fail) return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
    return route.fulfill({ json: { cachedAt: state.completed ? '2026-10-04T12:30:00Z' : null,
      sources: state.completed ? [{ title: 'New developer tools', url: 'https://raycast.com/blog/launch', date: '2026-10-03', summary: 'Real source summary from the worker cache.' }] : [],
      calls: [{ id: 'search-1', query: 'Raycast launch announcement', status: state.completed ? 'done' : 'running', at: '2026-10-04T12:30:00Z', durationMs: state.completed ? 1400 : 0, results: state.completed ? 6 : null }] } });
  });
  await page.route('https://maincloud.spacetimedb.com/**', route => {
    const request = route.request();
    if (request.url().includes('/call/')) { state.calls++; return route.fulfill({ status: 400, body: 'Unexpected inference' }); }
    const query = request.postData() ?? '', table = query.match(/FROM\s+(\w+)/i)?.[1];
    let rows: Row[] = [];
    if (table === 'campaign_flow') {
      rows = ['first', 'second', 'past'].map((id, i) => ({ campaign_id: id, brand: 'raycast', source: 'generate', stage: id === 'past' ? 'shipped' : 'concepts', draft_a: '', draft_b: '', experiment_id: 0, created_at: 100 - i }));
      if (query.includes('requested_by')) expect(query).toBe(`SELECT * FROM campaign_flow WHERE requested_by = 0x${owner}`);
      else rows = rows.filter(row => query.includes(`'${row.campaign_id}'`));
    } else if (table === 'x_user') rows = [{ user_id: 'brand', username: 'raycast', name: 'Raycast' }];
    return route.fulfill({ json: wire(rows) });
  });
  return state;
}

test('Campaign shows owned drafts, live Exa results and a brief-grounded rationale without extra inference', async ({ page }) => {
  const state = await setup(page); await page.goto('/campaign?brand=raycast&id=first');
  const activity = page.getByRole('region', { name: 'Campaign activity' });
  await expect(activity.getByRole('button', { name: /Launch one/ })).toHaveAttribute('aria-current', 'true');
  await expect(activity.getByRole('button', { name: /Launch two/ })).toBeVisible();
  await expect(activity.getByRole('button')).toHaveCount(2);
  await expect(activity.getByText('Lead with faster development.')).toBeVisible();
  await expect(activity.getByText('For Developer tools · 30 audience profiles · 60% of your audience.')).toBeVisible();
  await expect(activity.getByText('Raycast launch announcement')).toBeVisible();
  await expect(activity.getByText('Searching', { exact: true })).toBeVisible();
  state.completed = true;
  await expect(activity.getByRole('link', { name: /New developer tools/ })).toHaveAttribute('href', 'https://raycast.com/blog/launch');
  await expect(activity.getByText('6 results · 1.4s')).toBeVisible();
  await page.screenshot({ path: '/tmp/ripple-campaign-research-dark.png', fullPage: true });
  await activity.getByRole('button', { name: /Launch two/ }).click();
  await expect(page).toHaveURL(/id=second/);
  await expect(activity.getByText('Show the new shortcut.')).toBeVisible();
  await expect(activity.getByText('Lead with faster development.')).toHaveCount(0);
  expect(state.calls).toBe(0);
});

test('Research read errors retry and the light mobile layout stays within the page', async ({ page }) => {
  const state = await setup(page); state.fail = true;
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/campaign?brand=raycast&id=first');
  const activity = page.getByRole('region', { name: 'Campaign activity' });
  await expect(activity.getByText(/Research activity is unavailable/)).toBeVisible();
  state.fail = false; state.completed = true;
  await activity.getByRole('button', { name: 'Try again' }).click();
  await expect(activity.getByRole('link', { name: /New developer tools/ })).toBeVisible();
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/ripple-campaign-research-light-mobile.png', fullPage: true });
  expect(state.calls).toBe(0);
});
