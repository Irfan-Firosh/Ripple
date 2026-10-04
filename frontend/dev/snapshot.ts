import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

// Records the reads a VITE_SNAPSHOT_RECORD=1 dev session makes into snapshot/sql.json (query -> rows).
const directory = fileURLToPath(new URL('../snapshot/', import.meta.url));
const file = `${directory}sql.json`;

export function snapshotPlugin(): Plugin {
  let queries: Record<string, unknown[]> | null = null;
  let writing = Promise.resolve();
  return {
    name: 'ripple-snapshot-recorder',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__snapshot', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          writing = writing.then(async () => {
            queries ??= JSON.parse(await readFile(file, 'utf8').catch(() => '{}'));
            const { query, rows } = JSON.parse(body) as { query: string; rows: unknown[] };
            queries![query] = rows;
            await mkdir(directory, { recursive: true });
            await writeFile(file, JSON.stringify(queries));
          }).catch(error => server.config.logger.error(`[snapshot] ${error}`));
          res.statusCode = 204;
          res.end();
        });
      });
    },
  };
}
