// Copies the ZetaJS wrapper out of node_modules into public/ so it can be served
// at /vendor/zetajs/zeta.js (the first entry of Module.uno_scripts).
//
// Runs automatically via the `predev` / `prebuild` npm scripts.

import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgRoot = join(root, 'node_modules', 'zetajs');
const src = join(pkgRoot, 'source');
const dest = join(root, 'public', 'vendor', 'zetajs');

if (!existsSync(join(src, 'zeta.js'))) {
  console.error('[copy-vendor] `zetajs` not found in node_modules. Run `npm install` first.');
  process.exit(1);
}

mkdirSync(dest, { recursive: true });

// zetaHelper.js is optional (a higher-level convenience layer); copy if present.
for (const file of ['zeta.js', 'zetaHelper.js']) {
  const from = join(src, file);
  if (existsSync(from)) {
    copyFileSync(from, join(dest, file));
    console.log('[copy-vendor] ->', join('public', 'vendor', 'zetajs', file));
  }
}

// zetajs is MIT — ship its license alongside the redistributed code.
const licenseFrom = join(pkgRoot, 'LICENSE');
if (existsSync(licenseFrom)) {
  copyFileSync(licenseFrom, join(dest, 'LICENSE'));
  console.log('[copy-vendor] ->', join('public', 'vendor', 'zetajs', 'LICENSE'));
}
