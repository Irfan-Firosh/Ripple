import { test, expect } from '@playwright/test';

test('the same signed-in avatar appears across workspace and onboarding routes', async ({ page }) => {
  await page.route('**/node_modules/.vite/deps/@clerk_react.js*', route => route.fulfill({ contentType: 'application/javascript', body: `
    import React from '/node_modules/.vite/deps/react.js${new URL(route.request().url()).search}';
    export const ClerkProvider=p=>React.createElement('div',{'data-account-provider':'true'},p.children);
    export const Show=p=>p.when==='signed-in'?p.children:null;
    export const UserButton=()=>React.createElement('button',{'aria-label':'Your profile'},React.createElement('img',{src:'/login-light.png',alt:'Your avatar',width:32,height:32}));
    export const ClerkLoading=()=>null;
  ` }));
  await page.route('**/src/creative/useCreative.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `export const useCreative=()=>({ready:true,campaigns:[],briefs:[],variants:[],jobs:[],audience:[],affinities:[],catalog:[],brandKits:[],run:()=>Promise.resolve()});` }));
  await page.route('**/src/home/homeData.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `export const listHomeCampaigns=async()=>[];export const listCampaignFlows=async()=>[];export const loadHomeStats=async()=>({profiles:0,analyzed:0,audiences:[]});export const campaignDate=()=>'';export const campaignDestination=()=>'/home';` }));
  await page.route('https://maincloud.spacetimedb.com/**', route => route.fulfill({ json: route.request().url().endsWith('/identity') ? { token: 'test-only-token' } : [{ schema: { elements: [] }, rows: [] }] }));
  for (const path of ['/home', '/campaign?brand=raycast', '/lab?brand=raycast', '/dashboard?brand=raycast', '/onboarding']) {
    await page.goto(path);
    const account = page.locator('.workspace-account');
    await expect(account.getByRole('button', { name: 'Your profile' })).toBeVisible();
    await expect(account.getByRole('img', { name: 'Your avatar' })).toHaveAttribute('src', '/login-light.png');
    await expect(page.locator('[data-account-provider]')).toHaveCount(1);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(account).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.setViewportSize({ width: 1280, height: 720 });
  }
});
