// Render the card UI from an SVG layout, preserving the supplied background.
// npm install --prefix /private/tmp/ripple-fetchai-renderer --no-save @resvg/resvg-js
// node scripts/render-fetchai-buttons.mjs /private/tmp/ripple-fetchai-renderer
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';

const rendererRoot = process.argv[2];
if (!rendererRoot) throw new Error('Pass the directory containing the installed @resvg/resvg-js package.');
const requireRenderer = createRequire(join(resolve(rendererRoot), 'package.json'));
const { Resvg } = requireRenderer('@resvg/resvg-js');
const repo = fileURLToPath(new URL('../', import.meta.url));
const labels = JSON.parse(readFileSync(join(repo, 'backend/ripple_agents/button_labels.json'), 'utf8'));
const background = readFileSync(join(repo, 'frontend/public/dark_background.png')).toString('base64');
const output = join(repo, 'frontend/public/fetchai-buttons');
mkdirSync(output, { recursive: true });
const escapeXml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

for (const [label, file] of Object.entries(labels)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="800" height="96" viewBox="0 0 800 96">
    <defs>
      <clipPath id="shape"><rect width="800" height="96" rx="22"/></clipPath>
      <filter id="shadow" x="-20%" y="-50%" width="140%" height="200%"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity=".9"/></filter>
    </defs>
    <g clip-path="url(#shape)">
      <image width="800" height="96" preserveAspectRatio="xMidYMid slice" xlink:href="data:image/png;base64,${background}"/>
      <rect width="800" height="96" fill="#071225" opacity=".34"/>
    </g>
    <rect x="1" y="1" width="798" height="94" rx="21" fill="none" stroke="#fff" stroke-opacity=".2" stroke-width="2"/>
    <text x="400" y="57" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="600" fill="#fff" filter="url(#shadow)">${escapeXml(label)}</text>
  </svg>`;
  const image = new Resvg(svg, { font: { loadSystemFonts: true } }).render().asPng();
  writeFileSync(join(output, `${file}.png`), image);
  console.log(`${file}.png: ${image.byteLength} bytes`);
}
