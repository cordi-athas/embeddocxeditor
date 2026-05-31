// Fetches the PINNED LibreOffice-WASM payload into public/wasm/<pin>/ so the
// editor boots from same-origin, version-locked bytes instead of the rolling
// ZetaOffice CDN `_latest` alias.
//
// Why pin? `_latest` is rebuilt over time (and cached only ~20 min). Loading it
// at runtime means your app's behaviour can change underneath you and offline
// caches can desync. This script freezes one exact build, verified by sha256
// against scripts/wasm-pin.json, so every boot is reproducible.
//
// Runs automatically via `predev` / `prebuild` (idempotent: skips files already
// present with the right size). The large payload is git-ignored — committing
// the manifest + this script is enough to reproduce it anywhere.
//
// soffice.wasm / soffice.data are stored Brotli-compressed (that is how upstream
// ships them) and served with `Content-Encoding: br`; we keep the exact bytes, so
// downloads use `Accept-Encoding: identity` and never auto-decompress — the bytes
// on disk match the sha256 in the manifest 1:1.
//
// Usage:
//   node scripts/fetch-wasm.mjs            # fetch missing/changed files
//   node scripts/fetch-wasm.mjs --verify   # also re-hash files already on disk
//
// Requires Node 18+.

import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { get as httpsGet } from 'node:https';

/** Download a URL to a Buffer, following redirects, WITHOUT auto-decompression. */
function download(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = httpsGet(
      url,
      { headers: { 'Accept-Encoding': 'identity', 'User-Agent': 'embeddocx-fetch-wasm' } },
      (res) => {
        const { statusCode = 0, headers } = res;
        if (statusCode >= 300 && statusCode < 400 && headers.location) {
          res.resume();
          if (redirects > 5) return reject(new Error('too many redirects'));
          return resolve(download(new URL(headers.location, url).toString(), redirects + 1));
        }
        if (statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${statusCode}`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
  });
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'scripts', 'wasm-pin.json');
const fullVerify = process.argv.includes('--verify') || process.argv.includes('-v');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const { pin, source, files } = manifest;
if (!pin || !source || !Array.isArray(files)) {
  console.error('[fetch-wasm] Malformed scripts/wasm-pin.json (need pin, source, files[]).');
  process.exit(1);
}
const base = source.endsWith('/') ? source : source + '/';
const destDir = join(root, manifest.dir || 'public/wasm', pin);
mkdirSync(destDir, { recursive: true });

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

console.log(`[fetch-wasm] pin "${pin}"  ->  ${join(manifest.dir || 'public/wasm', pin)}`);

let downloaded = 0;
let failed = 0;

for (const file of files) {
  const { name, bytes, sha256: want } = file;
  const out = join(destDir, name);

  // Fast path: present with the expected size. Re-hash only with --verify.
  if (existsSync(out) && statSync(out).size === bytes) {
    if (fullVerify) {
      const got = sha256(readFileSync(out));
      if (got !== want) {
        console.error(`[fetch-wasm] ✗ ${name}: sha256 mismatch on disk\n   want ${want}\n   got  ${got}`);
        failed++;
        continue;
      }
      console.log(`[fetch-wasm] ✓ ${name} (verified)`);
    } else {
      console.log(`[fetch-wasm] · ${name} (cached)`);
    }
    continue;
  }

  // Download + verify size and sha256 before writing — never serve unverified bytes.
  const url = base + name;
  process.stdout.write(`[fetch-wasm] ↓ ${name} … `);
  let buf;
  try {
    buf = await download(url);
  } catch (e) {
    console.log('FAILED');
    console.error(`[fetch-wasm]   download error for ${url}: ${e.message}`);
    failed++;
    continue;
  }

  if (buf.length !== bytes) {
    console.log('FAILED');
    console.error(`[fetch-wasm]   size mismatch: want ${bytes}, got ${buf.length}`);
    failed++;
    continue;
  }
  const got = sha256(buf);
  if (got !== want) {
    console.log('FAILED');
    console.error(`[fetch-wasm]   sha256 mismatch:\n   want ${want}\n   got  ${got}`);
    console.error('[fetch-wasm]   Upstream bytes differ from the pin. If this is an intentional');
    console.error('[fetch-wasm]   re-pin, update scripts/wasm-pin.json; otherwise do NOT use them.');
    failed++;
    continue;
  }

  writeFileSync(out, buf);
  console.log(`OK (${buf.length} bytes)`);
  downloaded++;
}

if (failed > 0) {
  console.error(`\n[fetch-wasm] ${failed} file(s) failed — see errors above.`);
  process.exit(1);
}
console.log(
  downloaded > 0
    ? `\n[fetch-wasm] Done — ${downloaded} file(s) fetched, payload pinned.`
    : `\n[fetch-wasm] Up to date — all pinned files present.`,
);
