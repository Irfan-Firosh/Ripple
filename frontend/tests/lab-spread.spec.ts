import { expect, test, type Page } from '@playwright/test';

async function fixture(page: Page, fail = false) {
  const sizes = [70, 51, 30, 27, 26, 19];
  const slugs = ['startups_product', 'ai_llms', 'dev_community', 'crypto_web3', 'design_creative', 'culture_lifestyle'];
  const labels = ['Startups', 'AI models', 'Developers', 'Crypto', 'Design', 'Culture'];
  const people = sizes.flatMap((size, group) => Array.from({ length: size }, (_, i) => ({ id: `g${group}-${i}`, group, handle: `person_${group}_${i}` })));
  const tables: Record<string, Record<string, unknown>[]> = {
    niche: slugs.map((slug, i) => ({ slug, label: labels[i] })),
    x_user: [{ user_id: 'brand', username: 'trycua', name: 'Cua', profile_image_url: '/login-dark.png', followers_count: 1000 },
      ...people.map(p => ({ user_id: p.id, username: p.handle, name: `Person ${p.id}`, profile_image_url: '/login-dark.png', followers_count: 100, post_count: 12, description: '' }))],
    twin: people.map(p => ({ user_id: p.id, username: p.handle, post_count: 12, engagement_rate: .1, reply_share: .2, tone: '', persona_summary: '', hot_buttons: [] })),
    twin_niche: people.flatMap(p => [{ user_id: p.id, niche: slugs[p.group], affinity: .9 }, { user_id: p.id, niche: slugs[(p.group + 1) % 6], affinity: .5 }]),
    twin_audience: people.map(p => ({ brand_user_id: 'brand', user_id: p.id })),
    audience_membership: people.map(p => ({ brand_user_id: 'brand', follower_user_id: p.id })),
    x_post: [], x_post_entity: [], ops_hidden: [],
    lab_experiment: [{ experiment_id: 32, draft_a: 'Cua Spaces gives every AI agent its own workspace.', draft_b: 'Watch your AI agents work in Cua Spaces.', status: 'done', created_at: 100 }],
  };
  const requests: string[] = [];
  await page.route('https://maincloud.spacetimedb.com/**', route => {
    expect(route.request().url()).toMatch(/\/sql$/); // No identity, writes or inference from this preview.
    const query = route.request().postData() ?? ''; requests.push(query);
    if (fail) return route.fulfill({ status: 503, body: 'Unavailable' });
    const table = query.match(/FROM\s+(\w+)/i)?.[1] ?? '';
    if (!(table in tables)) throw new Error(`Unexpected read: ${query}`);
    const rows = tables[table], keys = rows.length ? Object.keys(rows[0]) : ['id'];
    return route.fulfill({ json: [{ schema: { elements: keys.map(key => ({ name: { some: key }, algebraic_type: { String: {} } })) }, rows: rows.map(row => keys.map(key => row[key])) }] });
  });
  return requests;
}

test('audience sampling preserves ratios, connected reach and repost popup coverage', async ({ page }) => {
  await fixture(page); await page.goto('/');
  const check = await page.evaluate(async () => {
    const { loadSpreadAudience } = await import('/src/lab-preview/previewAudience.ts');
    const { createSpreadScene } = await import('/src/lab-preview/spreadScene.ts');
    const { synchronizeSpread, SPREAD_SLOWDOWN } = await import('/src/lab-preview/reactionNotices.ts');
    const audience = await loadSpreadAudience('trycua', new AbortController().signal);
    const routes = Array.from({ length: 40 }, (_, i) => {
      const original = createSpreadScene(audience, i + 1, 'A new AI workspace', 'An AI agent for your Mac');
      const { scene, notices } = synchronizeSpread(original, i + 1);
      const valid = [scene.a, scene.b].every(trial => trial.handoffs.every(handoff => {
        if (handoff.from === null) return true;
        const from = handoff.from, actor = handoff.actor;
        const event = trial.events.find(e => e.action === 'repost' && e.person === actor && (e.target === handoff.to || e.targets?.includes(handoff.to)) && e.at === handoff.at);
        const link = audience.links.find(l => l.a === from && l.b === handoff.to || l.b === from && l.a === handoff.to);
        const actors = link?.a === from ? link.actorsA : link?.actorsB;
        return Boolean(event && actor !== null && audience.people[actor].group === from && actors?.includes(actor)
          && handoff.arrives > handoff.at && trial.events.filter(e => audience.people[e.person].group === handoff.to).every(e => e.at > handoff.arrives));
      }));
      const noticeValid = notices.every((notice, index) => (notice.draft === 'A' ? scene.a : scene.b).events.includes(notice.event)
        && notice.event.featured && Math.abs(notice.at - notice.event.at) < .00001 && (!index || notice.at >= notices[index - 1].until + .25));
      const slowed = scene.duration >= original.duration * SPREAD_SLOWDOWN;
      const reached = [scene.a, scene.b].every(trial => new Set(trial.handoffs.map(h => h.to)).size === 6);
      const coverage = (['A', 'B'] as const).every(draft => {
        const count = (draft === 'A' ? scene.a : scene.b).events.filter(e => e.action === 'repost').length;
        const shown = notices.filter(n => n.draft === draft && n.event.action === 'repost').length;
        return shown >= Math.ceil(count * .4);
      });
      const bothNotified = new Set(notices.map(notice => notice.draft)).size === 2;
      return { a: scene.a.events.length, b: scene.b.events.length, valid, noticeValid, slowed, reached, coverage, bothNotified, firstNotice: notices[0]?.draft };
    });
    const crypto = audience.communities.findIndex(group => group.slug === 'crypto_web3');
    const disconnected = { ...audience, links: audience.links.filter(link => link.a !== crypto && link.b !== crypto) };
    const isolatedScene = createSpreadScene(disconnected, 12, 'An AI workspace', 'A new AI model');
    const isolatedStaysUnreached = [isolatedScene.a, isolatedScene.b].every(trial => !trial.handoffs.some(handoff => handoff.to === crypto)
      && trial.events.every(event => audience.people[event.person].group !== crypto));
    return { routes, isolatedStaysUnreached, quotas: audience.communities.map(g => ({ size: g.size, sample: g.sampleSize, share: g.share })),
      validPeople: audience.people.every(p => /^g[0-5]-\d+$/.test(p.userId)), total: audience.total };
  });
  expect(check.validPeople).toBe(true); expect(check.total).toBe(223);
  expect(check.quotas.reduce((sum, g) => sum + g.sample, 0)).toBe(112);
  expect(check.quotas.reduce((sum, g) => sum + g.share, 0)).toBe(100);
  for (const group of check.quotas) expect(Math.abs(group.sample - group.size * 112 / 223)).toBeLessThan(1);
  expect(check.routes.every(route => route.valid)).toBe(true);
  expect(check.routes.every(route => route.reached)).toBe(true);
  expect(check.isolatedStaysUnreached).toBe(true);
  expect(check.routes.every(route => route.coverage)).toBe(true);
  expect(check.routes.some(route => route.a > route.b)).toBe(true);
  expect(check.routes.some(route => route.b > route.a)).toBe(true);
  expect(check.routes.every(route => route.noticeValid)).toBe(true);
  expect(check.routes.every(route => route.slowed)).toBe(true);
  expect(check.routes.every(route => route.bothNotified)).toBe(true);
  expect(new Set(check.routes.map(route => route.firstNotice)).size).toBe(2);
});
