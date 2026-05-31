/**
 * Pinned LibreOffice-WASM build id. MUST match `pin` in `scripts/wasm-pin.json`.
 * Bump both together when re-pinning to a newer upstream build.
 */
export const WASM_PIN = '2025-05-13';

/**
 * Where the LibreOffice-WASM runtime (soffice.{js,wasm,data}, ~52 MB) is served from.
 *
 * Default: a **version-pinned, self-hosted** copy under `public/wasm/<pin>/`,
 * fetched by `npm run fetch:wasm` (auto-runs on `predev`/`prebuild`) and verified
 * by sha256 against `scripts/wasm-pin.json`. This is served same-origin, so:
 *   • boots are reproducible — immune to the ZetaOffice CDN's rolling `_latest`,
 *   • no `Cross-Origin-Resource-Policy` dance (same-origin ⇒ COEP is satisfied),
 *   • offline is fully under your control (the bytes ship in your build).
 *
 * Alternatives (just change this constant):
 *   • CDN, latest:  'https://cdn.zetaoffice.net/zetaoffice_latest/'  (zero setup, NOT pinned)
 *   • flat self-host: ''  (soffice.* placed directly in public/ root)
 *
 * IMPORTANT: must end with a trailing slash (unless '').
 */
// Typed as `string` (not the literal) so the build target can be switched freely.
export const SOFFICE_BASE_URL: string = `/wasm/${WASM_PIN}/`;

/**
 * The `zeta.js` UNO wrapper. Copied from `node_modules/zetajs/source/zeta.js`
 * into `public/vendor/zetajs/` by `npm run copy:vendor` (runs automatically
 * before `dev`/`build`). Loaded as the FIRST entry of `Module.uno_scripts`.
 */
export const ZETA_JS_URL = '/vendor/zetajs/zeta.js';

/**
 * Our worker-thread script. Plain JS in `public/` (NOT bundled by Vite) because
 * it is loaded into the LibreOffice WASM worker context, where the `Module` and
 * `zetajs` globals live. Loaded as the SECOND entry of `Module.uno_scripts`.
 */
export const WORKER_URL = '/office_thread.js';
