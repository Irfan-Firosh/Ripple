import { test, expect } from '@playwright/test';

// Imports labData through Vite in a real page so it runs against the live SpacetimeDB tables (no mock data).
test('labData lists experiments and loads niches and counts for raycast.com', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const lab = await import('/src/lab/labData.ts');
    const list = await lab.listExperiments('raycast.com');
    const niches = await lab.loadLabNiches('raycast.com');
    const first = list[0] ? await lab.loadExperiment(list[0].id) : null;
    const counts = first?.a ? lab.countsAt(first.a) : null;
    return { n: list.length, sorted: list.every((e, i) => i === 0 || list[i - 1].createdAt >= e.createdAt),
             niches: niches.length, other: niches.some(n => /other/i.test(n.label)),
             signals: first?.a?.signals ? Object.keys(first.a.signals) : [], counts };
  });
  expect(result.n).toBeGreaterThan(0);            // Task 7 seeds experiments before this runs
  expect(result.sorted).toBe(true);
  expect(result.niches).toBeLessThanOrEqual(7);
  expect(result.other).toBe(false);
  expect(result.signals).toEqual(['like', 'repost', 'reply', 'quote']);
});

test('requestExperiment surfaces the reducer error for an empty draft', async ({ page }) => {
  await page.goto('/');
  const message = await page.evaluate(async () => {
    const lab = await import('/src/lab/labData.ts');
    try { await lab.requestExperiment({ brand: 'raycast.com', title: 't', draftA: ' ', draftB: 'b' }); return 'no error'; }
    catch (e) { return (e as Error).message; }
  });
  expect(message).toMatch(/drafts must be/);
});
