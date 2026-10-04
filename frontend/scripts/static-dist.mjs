// After `vite build` in snapshot mode: drop every generated render from dist, then add the snapshot's own
// media and its recorded reads (served as /snapshot.json).
import { cp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
await rm(join(root, 'dist/generated'), { recursive: true, force: true });
await cp(join(root, 'snapshot/public'), join(root, 'dist'), { recursive: true });
await cp(join(root, 'snapshot/sql.json'), join(root, 'dist/snapshot.json'));
await cp(join(root, 'snapshot/research'), join(root, 'dist/research-snapshot'), { recursive: true });
console.log('static dist ready');
