import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

type Row = Record<string, unknown>;
const wire = (rows: Row[]) => {
  const keys = Object.keys(rows[0] ?? {});
  return [{ schema: { elements: keys.map(name => ({ name: { some: name }, algebraic_type: { String: {} } })) }, rows: rows.map(row => keys.map(key => row[key])) }];
};

test('shared Fetch campaign renders the saved posts without queuing work under a different browser identity', async ({ page }) => {
  const calls: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/creative/useCreative.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export function useCreative() { return {ready:true,audience:[],affinities:[],catalog:[],campaigns:[],briefs:[],jobs:[],
      variants:[{variantId:'va',status:'ready',headline:'Short headline A',imageUrl:'/favicon.svg'},
                {variantId:'vb',status:'ready',headline:'Short headline B',imageUrl:'/favicon.svg'}],run:()=>Promise.reject(new Error('Shared view must not mutate'))};}
  ` }));
  await page.route('**/node_modules/.vite/deps/@clerk_react.js*', route => route.fulfill({ contentType: 'application/javascript', body: `export const ClerkProvider=p=>p.children;export const Show=()=>null;export const UserButton=()=>null;export const ClerkLoading=()=>null;` }));
  await page.route('https://maincloud.spacetimedb.com/**', route => {
    const req = route.request();
    if (req.url().includes('/call/') || req.url().endsWith('/identity')) {
      calls.push(req.url()); return route.fulfill({ status: 403, body: 'Shared view must not mutate' });
    }
    const table = (req.postData() ?? '').match(/FROM\s+(\w+)/i)?.[1];
    const rows: Row[] = table === 'x_user' ? [{ user_id: 'brand', username: 'supermemory', name: 'Supermemory', profile_image_url: '' }]
      : table === 'campaign_flow' ? [{ campaign_id: 'chat-c', brand: 'supermemory', source: 'generate', stage: 'concepts', draft_a: '', draft_b: '', experiment_id: 0, video_id: '', winner_text: '' }]
      : table === 'draft_copy' ? [{ draft: 'A', status: 'done', headline: 'Short headline A', text: 'The full brand-voice post A.' }, { draft: 'B', status: 'done', headline: 'Short headline B', text: 'The full brand-voice post B.' }]
      : table === 'video_mode' ? [{ key: 'global', mode: 'off' }] : [];
    return route.fulfill({ json: wire(rows) });
  });
  await page.goto('/campaign?brand=supermemory&id=chat-c&view=1');
  await expect(page.getByText('The full brand-voice post A.', { exact: true })).toBeVisible();
  await expect(page.getByText('The full brand-voice post B.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Test A vs B', exact: true })).toBeDisabled();
  await expect(page.getByText(/Continue testing, editing, and approving/)).toBeVisible();
  await expect(page).toHaveURL(/view=1/);
  expect(calls).toEqual([]);
  expect(errors).toEqual([]);
});

test('real Fetch rehearsal opens its saved campaign, videos and exact experiment analysis', async ({ page }) => {
  test.skip(process.env.RIPPLE_FETCH_WORKFLOW_LIVE_TEST !== '1', 'Requires scripts/fetch_workflow_check.py.');
  test.setTimeout(120_000);
  const artifact = process.env.RIPPLE_FETCH_WORKFLOW_ARTIFACT || '/tmp/ripple-fetch-workflow.json';
  const events = JSON.parse(readFileSync(artifact, 'utf8')) as { kind: string; passed?: boolean; text?: string; campaign_id?: string }[];
  expect(events.find(event => event.kind === 'complete')?.passed).toBe(true);
  const campaign = events.find(event => event.kind === 'generated_campaign')?.campaign_id;
  expect(campaign).toBeTruthy();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`/campaign?brand=supermemory&id=${campaign}&view=1`);
  await expect(page.getByText(/Continue testing, editing, and approving/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ready to ship.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ship it to X' })).toHaveAttribute('href', /https:\/\/x.com\/intent\/post\?/);
  if (events.some(event => event.kind === 'videos_completed')) {
    const video = page.locator('video');
    await expect(video).toHaveAttribute('src', /generated\/videos/);
    await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState)).toBeGreaterThan(0);
    const status = [...events].reverse().find(event => event.kind === 'result' && event.text?.includes('[Draft A video]') && event.text.includes('[Draft B video]'))?.text ?? '';
    const sources = [...status.matchAll(/\[Draft [AB] video\]\(([^)]+)\)/g)].map(match => match[1]);
    expect(sources).toHaveLength(2);
    for (const source of sources) {
      const media = await page.request.get(source);
      expect(media.ok()).toBe(true);
      expect(media.headers()['content-type']).toMatch(/^video\//);
    }
  }
  const office = events.find(event => event.kind === 'office_demo_completed')?.text ?? '';
  const lab = office.match(/\[Watch A vs B play out live\]\(([^)]+)\)/)?.[1];
  expect(lab).toBeTruthy();
  await page.goto(lab!);
  await expect(page.getByRole('article', { name: 'Draft A', exact: true })).toContainText('STOP SCROLLING');
  await expect(page.getByRole('article', { name: 'Draft B', exact: true })).toContainText('Give your AI agents memory');
  await page.getByRole('button', { name: 'Side-by-side analysis', exact: true }).click();
  const analysis = page.getByRole('dialog', { name: 'Side-by-side analysis' });
  await expect(analysis.getByRole('figure')).toHaveCount(2);
  await expect(analysis.getByRole('table')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(analysis).toHaveCount(0);
  expect(errors).toEqual([]);
});
