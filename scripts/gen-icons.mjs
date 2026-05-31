// Rasterisiert extension/icons/icon.svg zu den von Chrome benötigten PNG-Größen.
// Aufruf: npm run icons
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = join(root, 'extension', 'icons');
const svg = readFileSync(join(iconsDir, 'icon.svg'), 'utf8');

for (const size of [16, 32, 48, 128]) {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
  writeFileSync(join(iconsDir, `icon${size}.png`), resvg.render().asPng());
  console.log(`icon${size}.png`);
}
