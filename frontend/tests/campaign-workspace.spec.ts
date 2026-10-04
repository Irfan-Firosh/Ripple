import { expect, test, type Page } from '@playwright/test';

type Row = Record<string, unknown>;
const wire = (rows: Row[]) => {
  const keys = Object.keys(rows[0] ?? {});
  return [{ schema: { elements: keys.map(name => ({ name: { some: name }, algebraic_type: { String: {} } })) }, rows: rows.map(row => keys.map(key => row[key])) }];
};
async function setup(page: Page) {
  const state = { flow: null as Row | null, calls: [] as { reducer: string; args: unknown[] }[], created: null as Row | null };
  await page.route('**/src/creative/useCreative.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export function useCreative() { return { ready:true, audience:Array.from({length:16},(_,i)=>({brandUserId:'brand',userId:'u'+i})),
      affinities:Array.from({length:16},(_,i)=>({userId:'u'+i,niche:'dev_tools',affinity:1})),catalog:[{slug:'dev_tools',label:'Developer tools'}],
      briefs:[],variants:[],jobs:[],run: fn=>fn({reducers:{createCampaign: data=>fetch('/test-create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})}}) }; }
  ` }));
  await page.route('**/test-create', route => { state.created = route.request().postDataJSON() as Row; return route.fulfill({ body: '' }); });
  await page.route('**/node_modules/.vite/deps/@clerk_react.js*', route => route.fulfill({ contentType: 'application/javascript', body: `export const ClerkProvider=p=>p.children;export const Show=()=>null;export const UserButton=()=>null;export const ClerkLoading=()=>null;` }));
  await page.route('**/src/home/homeData.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `export const listHomeCampaigns=async()=>[];export const listCampaignFlows=async()=>[];export const loadHomeStats=async()=>({profiles:0,analyzed:0,audiences:[]});export const campaignDate=()=>'';export const campaignDestination=()=>'/home';` }));
  await page.route('https://maincloud.spacetimedb.com/**', route => {
    const req = route.request(), reducer = req.url().split('/call/')[1];
    if (req.url().endsWith('/identity')) return route.fulfill({ json: { token: 'test-only-session' } });
    if (reducer) {
      const args = req.postDataJSON() as unknown[]; state.calls.push({ reducer, args });
      if (reducer === 'start_campaign_flow') state.flow = { campaign_id: args[0], brand: args[1], source: args[2], draft_a: args[3], draft_b: args[4], stage: 'concepts', experiment_id: 0, video_id: '', winner_text: '' };
      else expect(reducer).toBe('request_draft_video');
      return route.fulfill({ body: '' });
    }
    const query = req.postData() ?? '', table = query.match(/FROM\s+(\w+)/i)?.[1];
    const rows: Row[] = table === 'x_user' ? [{ user_id: 'brand', username: 'raycast', name: 'Raycast', profile_image_url: '' }]
      : table === 'x_post' ? [{ post_id: 'p1', text: 'Your existing launch post.', created_at: '2026-10-04' }]
      : table === 'campaign_flow' && state.flow ? [state.flow] : [];
    return route.fulfill({ json: wire(rows) });
  });
  return state;
}

test('Campaign offers generation and import under themed cloud artwork without creating work on load', async ({ page }) => {
  const state = await setup(page); await page.goto('/campaign?brand=raycast');
  await expect(page.getByRole('heading', { name: 'Make your next move.' })).toBeVisible();
  await expect(page.locator('.flow-cloud')).toHaveCSS('background-image', /login-dark\.png/);
  await expect(page.getByRole('button', { name: /Generate new campaign/ })).toBeVisible();
  await expect(page.getByLabel('Campaign workflow')).toContainText('Test');
  expect(state.calls).toEqual([]); expect(state.created).toBeNull();
  await page.screenshot({ path: '/tmp/ripple-campaign-dark.png', fullPage: true });
  await page.getByRole('button', { name: 'Import drafts' }).click();
  await expect(page.getByLabel('Draft A')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use these drafts' })).toBeDisabled();
  await page.getByLabel('Draft A').fill('First idea.'); await page.getByLabel('Draft B').fill('Second idea.');
  await page.getByRole('button', { name: 'Use these drafts' }).click();
  await expect(page.getByRole('heading', { name: 'Your two drafts.' })).toBeVisible();
  expect(state.calls.find(call => call.reducer === 'start_campaign_flow')?.args.slice(1)).toEqual(['raycast', 'import', 'First idea.', 'Second idea.']);
  await page.getByRole('button', { name: 'New campaign', exact: true }).click();
  await page.getByRole('button', { name: /Generate new campaign/ }).click();
  await expect.poll(() => state.created?.segments).toEqual(['dev_tools']);
  await expect(page.locator('.flow-drafts-step .flow-waiting')).toContainText('Reading your audience');
  expect(state.calls.filter(call => call.reducer === 'start_campaign_flow').at(-1)?.args.slice(1)).toEqual(['raycast', 'generate', '', '']);
});

test('Campaign mobile is polished in light mode and workspace nav is white', async ({ page }) => {
  await setup(page); await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/campaign?brand=raycast');
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('.flow-cloud')).toHaveCSS('background-image', /login-light\.png/);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('navigation', { name: 'Workspace navigation' })).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Close navigation' }).click();
  await expect(page.locator('.fd-mobile-menu')).toHaveCount(0);
  await page.getByRole('button', { name: 'Import drafts' }).click();
  await expect(page.getByLabel('Draft B')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/ripple-campaign-import-light-mobile.png', fullPage: true });
});

test('workspace logos share geometry and desktop nav uses white only in light mode', async ({ page }) => {
  await setup(page); const positions: { x: number; y: number; width: number; height: number }[] = [];
  for (const route of ['/home', '/campaign?brand=raycast', '/lab?brand=raycast', '/dashboard?brand=raycast']) {
    await page.goto(route);
    const logo = page.getByRole('link', { name: 'Ripple home' }); await expect(logo).toHaveText('Ripple');
    await expect(logo).toHaveCSS('gap', '9px'); await expect(logo.locator('svg')).toHaveCSS('width', '24px');
    await page.evaluate(() => document.fonts.ready);
    positions.push((await logo.boundingBox())!);
    const nav = page.getByRole('navigation', { name: 'Workspace navigation' });
    await expect(nav).toHaveCSS('background-color', 'rgba(36, 36, 36, 0.93)');
    await page.getByRole('button', { name: 'Switch to light mode' }).click();
    await expect(nav).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  }
  for (const position of positions) expect(position).toEqual(positions[0]);
});
