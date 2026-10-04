// Copies only the generated media the recorded snapshot references (videos, thumbnails, images) into
// snapshot/public so a static deploy ships a few files instead of every render in public/generated.
import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const text = await readFile(join(root, 'snapshot/sql.json'), 'utf8');
const paths = [...new Set(text.match(/\/generated\/[^"'\s)\\?#]+/g) ?? [])];
await rm(join(root, 'snapshot/public'), { recursive: true, force: true });
let copied = 0, missing = 0;
for (const path of paths) {
  const from = join(root, 'public', path);
  if (!(await stat(from).catch(() => null))?.isFile()) { missing++; console.warn('missing', path); continue; }
  await mkdir(dirname(join(root, 'snapshot/public', path)), { recursive: true });
  await cp(from, join(root, 'snapshot/public', path));
  copied++;
}
console.log(`snapshot media: ${copied} copied, ${missing} missing`);
