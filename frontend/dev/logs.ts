import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { Plugin } from 'vite';

const exec = promisify(execFile);
const directory = fileURLToPath(new URL('../../data/logs/', import.meta.url));
// Background workers started from the repo write here (lab / onboarding / video workers).
const workerDirectory = fileURLToPath(new URL('../../.superpowers/logs/', import.meta.url));
const WORKER_LOGS: [string, string][] = [
  ['Lab worker', 'labworker.log'],
  ['Onboarding worker', 'onboarding-worker.log'],
  ['Video worker', 'video-worker.log'],
  ['Video worker 2', 'video-worker-2.log'],
  ['Tweet writer', 'copy-worker.log'],
];
const redact = (text: string) => text
  .replace(/\u001b\[[0-9;]*m/g, '')
  .replace(/(Bearer\s+)[^\s"']+/gi, '$1[redacted]')
  .replace(/((?:api[_-]?key|token|authorization)[\s"']*[:=][\s"']*)[^\s"',}]+/gi, '$1[redacted]');
const lines = (text: string) => redact(text).trim().split('\n').filter(Boolean).slice(-150);

export function logsPlugin(env: Record<string, string>): Plugin {
  const database = env.VITE_SPACETIMEDB_DATABASE || 'ripple-mhacks';
  const server = (env.VITE_SPACETIMEDB_URI || 'wss://maincloud.spacetimedb.com')
    .replace(/^ws:/, 'http:').replace(/^wss:/, 'https:').replace(/\/$/, '');
  const name = database.replace(/[^a-zA-Z0-9_-]/g, '_');
  type Source = { name: string; lines: string[]; error?: string };
  type Snapshot = { database: string; server: string; worker: { state: string; lastSeen?: string }; sources: Source[]; updatedAt: string };
  let cached: Snapshot | null = null;
  let pending: Promise<Snapshot> | null = null;
  async function snapshot(): Promise<Snapshot> {
    const sources = await Promise.all([
      (async (): Promise<Source> => {
        try {
          const result = await exec('spacetime', ['logs', database, '--server', server, '--no-config', '--num-lines', '150', '--format', 'text', '--yes'],
            { timeout: 5000, maxBuffer: 512_000 });
          return { name: 'SpacetimeDB', lines: lines(result.stdout) };
        } catch {
          return { name: 'SpacetimeDB', lines: [], error: 'Could not read database logs. Check that SpacetimeDB is running and the CLI is logged in.' };
        }
      })(),
      (async (): Promise<Source> => {
        try { return { name: 'Creative worker', lines: lines(await readFile(`${directory}/creative-${name}.log`, 'utf8')) }; }
        catch { return { name: 'Creative worker', lines: [], error: 'No worker log yet. Start the creative worker to capture live output.' }; }
      })(),
      ...WORKER_LOGS.map(async ([label, file]): Promise<Source> => {
        try { return { name: label, lines: lines(await readFile(`${workerDirectory}/${file}`, 'utf8')) }; }
        catch { return { name: label, lines: [], error: `No ${label.toLowerCase()} log yet. Start it to capture live output.` }; }
      }),
    ]);
    let worker: Snapshot['worker'] = { state: 'offline' };
    try {
      const status = JSON.parse(await readFile(`${directory}/creative-${name}.json`, 'utf8'));
      worker.lastSeen = status.updatedAt;
      if (status.database === database && status.server.replace(/\/$/, '') === server && status.state === 'running'
        && Date.now() - Date.parse(status.updatedAt) < 30_000 && Number.isInteger(status.pid) && status.pid > 0) {
        process.kill(status.pid, 0);
        worker.state = 'running';
      }
    } catch { /* No live worker heartbeat. Retain actual historical logs. */ }
    return { database, server, worker, sources, updatedAt: new Date().toISOString() };
  }
  return {
    name: 'ripple-local-logs',
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (req.url?.split('?')[0] !== '/api/logs') return next();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        const address = req.socket.remoteAddress || '';
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) {
          res.statusCode = 403; return res.end(JSON.stringify({ error: 'Server logs are available from localhost only.' }));
        }
        if (req.method !== 'GET') { res.statusCode = 405; return res.end(JSON.stringify({ error: 'Use GET to read logs.' })); }
        try {
          if (!cached || Date.now() - Date.parse(cached.updatedAt) >= 2500) {
            pending ||= snapshot().finally(() => { pending = null; });
            cached = await pending;
          }
          res.end(JSON.stringify(cached));
        } catch {
          res.statusCode = 503; res.end(JSON.stringify({ error: 'Logs are temporarily unavailable. Try refreshing.' }));
        }
      });
    },
  };
}
