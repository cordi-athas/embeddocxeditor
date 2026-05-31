import { defineConfig, type Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';

// LibreOffice-WASM uses threads (SharedArrayBuffer), which the browser only
// exposes to *cross-origin isolated* pages. That requires these two headers on
// EVERY response (dev, preview, AND production hosting):
//
//   Cross-Origin-Opener-Policy:   same-origin
//   Cross-Origin-Embedder-Policy: require-corp
//
// We self-host the soffice.* payload same-origin (public/wasm/<pin>/), so no
// `Cross-Origin-Resource-Policy` is needed for those assets. CORP below is only
// so this editor can be embedded as a cross-origin <iframe> by host pages.
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  // Allow this editor to be embedded as a cross-origin <iframe> by host pages
  // that are themselves cross-origin isolated (COEP: require-corp). Without this
  // the iframe is blocked. Does not weaken our own isolation.
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

// The pinned soffice.wasm / soffice.data are stored Brotli-compressed (that is
// how the ZetaOffice CDN ships them; see scripts/wasm-pin.json). They MUST be
// served with `Content-Encoding: br` so the browser transparently decompresses
// them — otherwise WebAssembly.compile sees raw Brotli and fails with
// "expected magic word 00 61 73 6d". The other /wasm/ files are plain.
//
// PRODUCTION: your static host must do the same — serve *.wasm and *.data under
// /wasm/ with `Content-Encoding: br` (+ Content-Type application/wasm for .wasm).
const BR_CONTENT_TYPE: Record<string, string> = {
  '.wasm': 'application/wasm',
  '.data': 'application/octet-stream',
};

function brotliWasm(): Plugin {
  const publicDir = join(process.cwd(), 'public');
  const handle = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = (req.url || '').split('?')[0];
    if (!url.startsWith('/wasm/')) return next();
    const ext = url.slice(url.lastIndexOf('.'));
    const type = BR_CONTENT_TYPE[ext];
    if (!type) return next(); // plain files (.js / .metadata / .svg): default static handling
    const file = normalize(join(publicDir, decodeURIComponent(url)));
    if (!(file === publicDir || file.startsWith(publicDir + sep)) || !existsSync(file)) return next();
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Encoding', 'br');
    res.setHeader('Content-Length', String(statSync(file).size));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    if (req.method === 'HEAD') return void res.end();
    createReadStream(file).pipe(res);
  };
  return {
    name: 'brotli-wasm-encoding',
    configureServer(server) {
      server.middlewares.use(handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handle);
    },
  };
}

export default defineConfig({
  plugins: [brotliWasm()],
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
});
