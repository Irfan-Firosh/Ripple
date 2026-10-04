import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import type { ResearchCall, ResearchSnapshot, ResearchSource } from '../src/flow/researchTypes';

const directory = fileURLToPath(new URL('../../data/research/', import.meta.url));
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';
const safeUrl = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !!url.hostname; } catch { return false; }
};

export async function researchSnapshot(brand: string, root = directory): Promise<ResearchSnapshot> {
  const snapshot: ResearchSnapshot = { sources: [], calls: [], cachedAt: null };
  let files: string[] = [];
  try { files = await readdir(root); } catch { /* No research has been recorded yet. */ }
  const prefix = `${brand}-`;
  const cache = files.filter(file => file.startsWith(prefix) && /^\d{4}-\d{2}-\d{2}\.json$/.test(file.slice(prefix.length))).sort().at(-1);
  if (cache) {
    try {
      const data: unknown = JSON.parse(await readFile(`${root}/${cache}`, 'utf8'));
      const news: unknown[] = object(data) && Array.isArray(data.news) ? data.news : [];
      snapshot.sources = news.filter((item): item is ResearchSource => object(item) && typeof item.title === 'string'
        && safeUrl(item.url) && typeof item.date === 'string' && typeof item.summary === 'string').slice(0, 6)
        .map(({ title, url, date, summary }) => ({ title, url, date, summary }));
      snapshot.cachedAt = (await stat(`${root}/${cache}`)).mtime.toISOString();
    } catch { /* A worker may still be writing the cache; read it on the next poll. */ }
  }
  try {
    const journal = await readFile(`${root}/activity/${brand}.jsonl`, 'utf8');
    const latest = new Map<string, ResearchCall>();
    for (const line of journal.trim().split('\n').slice(-120)) {
      try {
        const event: unknown = JSON.parse(line);
        if (object(event) && typeof event.id === 'string' && typeof event.query === 'string'
          && ['running', 'done', 'failed'].includes(String(event.status)) && typeof event.at === 'string'
          && typeof event.durationMs === 'number' && (event.results === null || typeof event.results === 'number')) {
          latest.set(event.id, { id: event.id, query: event.query, status: event.status as ResearchCall['status'],
            at: event.at, durationMs: event.durationMs, results: event.results });
        }
      } catch { /* Ignore an incomplete last line while the worker appends. */ }
    }
    snapshot.calls = [...latest.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);
  } catch { /* Older research caches have sources but no request journal. */ }
  return snapshot;
}

export function researchPlugin(): Plugin {
  async function handler(req: IncomingMessage, res: ServerResponse, next: () => void) {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname !== '/api/campaign-research') return next();
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '')) {
      res.statusCode = 403; return res.end(JSON.stringify({ error: 'Research activity is available locally.' }));
    }
    if (req.method !== 'GET') { res.statusCode = 405; return res.end(JSON.stringify({ error: 'Use GET.' })); }
    const brand = url.searchParams.get('brand') || '';
    if (!/^[a-z0-9_][a-z0-9_.-]{0,79}$/.test(brand)) {
      res.statusCode = 400; return res.end(JSON.stringify({ error: 'Invalid brand.' }));
    }
    try { res.end(JSON.stringify(await researchSnapshot(brand))); }
    catch { res.statusCode = 503; res.end(JSON.stringify({ error: 'Research is temporarily unavailable.' })); }
  }
  return { name: 'ripple-campaign-research', configureServer(vite) { vite.middlewares.use(handler); },
    configurePreviewServer(vite) { vite.middlewares.use(handler); } };
}
