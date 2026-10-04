import { expect, test } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { researchSnapshot } from '../dev/research';

test('Research reader isolates brands, deduplicates request transitions and tolerates partial writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ripple-research-'));
  try {
    await mkdir(join(root, 'activity'));
    await writeFile(join(root, 'raycast-2026-10-04.json'), JSON.stringify({ news: [
      { title: 'Launch', url: 'https://raycast.com/blog', date: '2026-10-03', summary: 'Saved source' },
      { title: 'Unsafe link', url: 'javascript:alert(1)', date: '', summary: '' },
    ], secret: 'never-return-this' }));
    const event = { id: '1', query: 'Raycast blog', at: '2026-10-04T12:30:00Z', durationMs: 0, results: null };
    await writeFile(join(root, 'activity/raycast.jsonl'), `${JSON.stringify({ ...event, status: 'running' })}\n${JSON.stringify({ ...event, status: 'done', results: 6 })}\n{"partial":`);
    const result = await researchSnapshot('raycast', root);
    expect(result.sources).toHaveLength(1); expect(result.calls).toHaveLength(1);
    expect(result.calls[0].status).toBe('done'); expect(result.cachedAt).not.toBeNull();
    expect(JSON.stringify(result)).not.toContain('never-return-this');
    expect(await researchSnapshot('spacetimedb', root)).toEqual({ sources: [], calls: [], cachedAt: null });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Research endpoint rejects path traversal and mutation requests', async ({ request }) => {
  expect((await request.get('/api/campaign-research?brand=..%2F..%2Fsecrets')).status()).toBe(400);
  expect((await request.post('/api/campaign-research?brand=raycast')).status()).toBe(405);
  const response = await request.get('/api/campaign-research?brand=no_recorded_research_123');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ sources: [], calls: [], cachedAt: null });
});
