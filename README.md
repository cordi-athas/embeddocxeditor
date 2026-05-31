# embeddocxeditor

**Offline-first, full-fidelity DOCX editor — entirely in the browser.**

Core engine: **LibreOffice compiled to WebAssembly** ([ZetaOffice / ZetaJS](https://github.com/allotropia/zetajs)).
Because the real LibreOffice layout engine runs in the browser, pagination, tables, numbering, headers/footers, fields, and change tracking render **exactly like Word** — no server, no file upload.

> Status: **working POC.** Verified: in-browser boot, DOCX open/render, DOCX save (round-trip), and **its own custom UI** — LibreOffice's menu/toolbar/sidebar/statusbar are hidden while our own toolbar on top dispatches `.uno:*` commands and reflects button state. Next up: [docs/ROADMAP.md](docs/ROADMAP.md).

---

## Why this architecture?

Constraints: **pure browser + 1:1 Word parity + offline + flexible license (no AGPL).**
The only realistic open-source base that meets this combination is ZetaJS. Full rationale and rejected alternatives (OnlyOffice-WASM/AGPL, eigenpal/parity-not-there-yet, engine-from-scratch): [docs/DECISION.md](docs/DECISION.md).

## Running

```bash
npm install
npm run dev      # http://localhost:5173  (predev: vendors zeta.js + pins/downloads the WASM)
```

Before the first `dev`/`build`, `npm run fetch:wasm` (runs automatically on predev/prebuild) downloads the **version-pinned** LibreOffice-WASM build (`scripts/wasm-pin.json`, ~52 MB) into `public/wasm/<pin>/` and **verifies every file by sha256**. The files are served **same-origin** (no runtime CDN dependency); the Service Worker caches them → **the second load works offline**. Details: [WASM version pinning](#wasm-version-pinning-default) below.

Production build:

```bash
npm run build && npm run preview
```

> **Required:** the page must be *cross-origin isolated* (LibreOffice threads need `SharedArrayBuffer`). Dev/preview headers are set in `vite.config.ts`. **In production too**, every response needs these two headers:
> ```
> Cross-Origin-Opener-Policy: same-origin
> Cross-Origin-Embedder-Policy: require-corp
> ```
> Also, the **`*.wasm` and `*.data`** files under `/wasm/` are stored **Brotli-compressed**; the host must serve them with `Content-Encoding: br` (`vite.config.ts` handles this for dev/preview — required on your production host too, otherwise an "expected magic word" error). See [WASM version pinning](#wasm-version-pinning-default).

## Saving — and an important gotcha

Use the **"Save" (DOCX) / "PDF" buttons at the top** to download the document to your real disk.
The document is exported as DOCX/PDF (`storeToURL`, `MS Word 2007 XML` / `writer_pdf_Export`) and:
- **In supporting browsers (Chromium):** a native **"Save As"** dialog opens — pick location + filename + extension (File System Access API, `showSaveFilePicker`).
- **In Firefox/Safari or a cross-origin iframe:** direct download (fallback).

Whether the document was opened via "Open"/"New" or from LibreOffice's own Start Center, the *active* document is resolved at save time.

> ℹ️ **Note (WASM virtual-FS gotcha):** LibreOffice's **own** Save opens a window like `/home/web_user` and writes to the WASM **virtual filesystem** — not your disk. That's why **Ctrl+S _and_ Ctrl+Shift+S are intercepted** (capture-phase, on a listener registered at module load) and routed into our save/export flow; LibreOffice's menu/toolbar are also hidden. So you normally never reach that window — use **File ▸ Save** at the top.

## How it works (overview)

```
Main thread                          LibreOffice-WASM worker (em-pthread)
─────────────                        ──────────────────────────────────
<canvas id=qtcanvas>  ◀── render ──  LibreOffice (Qt5) drawing
ZetaDocxEditor (TS)   ◀─ MessagePort ▶ public/office_thread.js
  FS.writeFile  ───────── /tmp/office/*.docx (shared Emscripten FS) ─────────▶ loadComponentFromURL
  FS.readFile   ◀──────── storeToURL(FilterName: "MS Word 2007 XML") ◀────────────
```

- `src/engine/zeta-engine.ts` — **the core of your package.** A clean API that hides every ZetaJS/UNO/Emscripten detail: `boot()`, `newDocument()`, `openDocx(File)`, `saveDocx(): Blob`, `dispatch('.uno:Bold')`, `onFormatState(cb)`.
- **Custom UI (Phase 3):** LibreOffice's menu/toolbar/sidebar/statusbar are hidden in the worker; our own toolbar (buttons with `data-uno`/`data-state` in `index.html`) dispatches `.uno:*` and reflects active-button state via `XStatusListener`.
- `public/office_thread.js` — worker; opens/creates/exports the document via the UNO API.
- `public/sw.js` — offline app-shell + WASM cache.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Embedding in another site

The whole editor lives under a single root (`.dxe`) and **styles are scoped to that root** — no clash with the host page's CSS. During boot the canvas sits behind a hidden overlay, so the user **never sees any of LibreOffice's UI (Start Center, menu, ruler, sidebar)** — only our UI.

Because cross-origin isolation (COOP/COEP) is required, **the most robust embedding path is an iframe**:

```html
<iframe
  src="https://your-host/"
  allow="cross-origin-isolated; clipboard-write"
  style="width:100%; height:600px; border:0; border-radius:10px"
></iframe>
```

- **The host page must be cross-origin isolated** (on its own server: `COOP: same-origin` + `COEP: require-corp`). An npm package can't set these; the host does.
- **The editor** sends `Cross-Origin-Resource-Policy: cross-origin` so it can be embedded (otherwise a cross-origin iframe is blocked under COEP) — set in `vite.config.ts`; send it in production too.

### React package: `embeddocx-react`

A ready-made component for React apps (`packages/react`): `<DocxEditor src=… document=… onChange=… ref=…/>`. Working example: `packages/react/example` (`npm i && npm run dev` → embeds the editor via iframe). Details: [packages/react/README.md](packages/react/README.md).

```tsx
import { DocxEditor, type DocxEditorHandle } from 'embeddocx-react';
const ref = useRef<DocxEditorHandle>(null);
<DocxEditor ref={ref} src="https://editor.example.com"
  document={bytes} onChange={() => setDirty(true)} onSave={save} />
// const out = await ref.current!.getDocx();
```

### Host API (SDK)

Your host page talks to the editor through a dependency-free SDK (`public/embed-sdk.js`).
The host **provides and retrieves the document programmatically** — no file dialog needed:

```js
import { DocxEditorClient } from 'https://YOUR-HOST/embed-sdk.js';

const editor = new DocxEditorClient(document.querySelector('iframe#editor'));
await editor.ready();

await editor.loadDocument(arrayBuffer, { name: 'report.docx' }); // load the document
editor.on('change', () => markDirty());                          // edited
const bytes = await editor.getDocx();                            // current DOCX (Uint8Array)

editor.newDocument();
editor.setTheme({ '--dxe-accent': '#2563eb' });
editor.dispatch('.uno:Bold');
```

| Method / event | What it does |
|------|-----|
| `ready()` | Resolves once the editor is ready (await before issuing commands) |
| `loadDocument(bytes, {name, readOnly})` | Load a document from the host |
| `getDocx() → Uint8Array` | Get the current document as DOCX bytes (for the host's own "Save") |
| `newDocument()` · `setTheme(vars)` · `dispatch(uno, args)` | new document / theme / raw UNO command |
| `on('ready' \| 'change' \| 'clean' \| 'save' \| 'error', cb)` | events |

Inside the editor, **Ctrl/Cmd+S** does not go to LibreOffice's internal save — when embedded it sends a **`save`** event to the host (which persists via `getDocx`), and standalone it downloads. Unsaved-change tracking is done with `change`/`clean`.

Documents cross the boundary as **ArrayBuffer** (no base64). Working example: **`packages/react/example`** — embeds the host via iframe and drives Load/Download/Theme.

### Security (cross-origin / postMessage)

The bridge is designed to be **origin-safe**:

- **The editor only acts on commands from its own embedder** (`event.source === window.parent`) and from an **allowed origin**. If no allowlist is given, it locks to the **first** host origin it sees (trust-on-first-use). Replies — especially the `getDocx` document bytes — go **only** to that trusted origin, never to `'*'`.
- **The SDK / React client** post messages to the **editor's own origin** (derived from the iframe `src`, not `'*'`) and validate `event.origin` on inbound events — i.e. automatic, no extra config.

For an explicit allowlist (instead of TOFU) and hardening, add parameters to the iframe `src`:

| Parameter | Effect |
|-----------|------|
| `?dxeParentOrigin=https://host.example` | Lock the editor to a single host origin |
| `?dxeAllowedOrigins=https://a.example,https://b.example` | Allow multiple origins |
| `?dxeAllowDispatch=0` | Disable the raw `.uno:` `dispatch` command |

In a standalone deploy you can also configure it via `installHostBridge(editor, root, hooks, { allowedOrigins, allowDispatch })`. (The decision logic is isolated in `src/embed-trust.ts` and unit-tested via `npm test`.)

## Theming

Recolor via CSS variables on `.dxe`:

```css
.dxe {
  --dxe-accent:  #2563eb;   /* accent (active button, spinner) */
  --dxe-surface: #ffffff;   /* toolbar background */
  --dxe-fg:      #1f2937;   /* text */
  --dxe-border:  #e6e8eb;
  --dxe-radius:  10px;
}
```

## Language (i18n)

The UI is **English by default**; currently **EN and TR**. Ways to choose:

- **At the code level:** `import { setLang } from './i18n'; setLang('tr');` (before init) or `DEFAULT_LANG` in `src/i18n.ts`.
- **iframe embed:** `src=".../?lang=tr"` (URL parameter).
- **React:** `<DocxEditor lang="tr" … />` (auto-converted to `?lang=`).

New strings go in the dictionary in `src/i18n.ts`; static DOM strings are applied via `applyI18n()`, dynamic ones via `t('key')`.

## License note (important)

- The **wrapper code in this repo (engine, UI, embed bridge, React package) is MIT** — [`LICENSE`](LICENSE). `embeddocx-react` is published as MIT too.
- The `zetajs` npm package is **MIT** (allotropia). Because it is redistributed, its license is copied to `public/vendor/zetajs/LICENSE` (`copy-vendor`).
- The LibreOffice-WASM payload (`soffice.*`) is **MPL-2.0 / LGPL-3.0+**. **The default setup version-pins these files and serves them from your own origin** (pin) — i.e. you *redistribute* them, so the MPL/LGPL terms apply to your distribution. The required artifacts ship in the repo: full license texts in [`licenses/`](licenses/) (MPL-2.0, LGPL-3.0, GPL-3.0) and the attribution/source/replacement notice in [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md). To minimize the obligation you can point `SOFFICE_BASE_URL` at the CDN `_latest` and fetch at runtime (but then the version isn't pinned).
- **Note:** the `embeddocx-react` package contains only the React wrapper (MIT); it does not bundle LibreOffice (it embeds a separately-deployed editor via iframe). The LibreOffice/Qt notices apply to the **editor web-app deployment**, not the npm package.
- Even though the license choices are settled, a **legal review is recommended before distribution.**

## WASM version pinning (default)

The `_latest` CDN alias is rebuilt over time (and cached only ~20 min); depending on it at runtime makes boots **non-reproducible** and can break silently. So by default **a single build is pinned** (`scripts/wasm-pin.json`, build date `2025-05-13`) and served same-origin:

- `npm run fetch:wasm` (auto on predev/prebuild) downloads the files from the source into `public/wasm/<pin>/` and verifies them by **sha256** against the manifest. On a mismatch it errors — unverified bytes are never served. `--verify` re-hashes the on-disk files too. The files are git-ignored (~52 MB); **committing the manifest + script is enough** (a fresh clone reproduces them exactly).
- `src/engine/config.ts` → `SOFFICE_BASE_URL = '/wasm/<pin>/'` (same-origin). Being same-origin, there is no CORP hassle and offline is entirely under your control.
- `soffice.wasm` and `soffice.data` are stored **Brotli-compressed** (the form the CDN ships) and must be served with `Content-Encoding: br`. `vite.config.ts` handles this in dev/preview; **your production host must also** serve `*.wasm` and `*.data` under `/wasm/` with `Content-Encoding: br` (+ `Content-Type: application/wasm` for `*.wasm`) — otherwise the browser treats the raw brotli as wasm and fails with **"expected magic word"**.

**Re-pinning:** bump `pin` in `scripts/wasm-pin.json` and `WASM_PIN` in `src/engine/config.ts`, delete `public/wasm/<old>`, update `source` (if needed), run `npm run fetch:wasm`, then write the new `bytes`/`sha256` values into the manifest.

**Pin-less alternative:** `SOFFICE_BASE_URL = 'https://cdn.zetaoffice.net/zetaoffice_latest/'` → zero setup, but the version isn't pinned (runtime CDN dependency). For fully plain (no-brotli) same-origin hosting, put the `soffice.*` files in the `public/` root and set `SOFFICE_BASE_URL = ''`.

## File map

| Path | Role |
|-----|-----|
| `src/engine/zeta-engine.ts` | Editor API (package core) |
| `src/engine/protocol.ts` | Main thread ↔ worker message contract |
| `src/engine/config.ts` | WASM pin (`SOFFICE_BASE_URL`, `WASM_PIN`) + asset URLs |
| `src/main.ts` | UI shell (toolbar, open/save, SW registration) |
| `public/office_thread.js` | LibreOffice worker (UNO driver) |
| `public/sw.js` | Offline cache (pinned `/wasm/` and CDN: cache-first; shell: network-first) |
| `vite.config.ts` | COOP/COEP headers + `/wasm/` Brotli (`Content-Encoding: br`) serving |
| `scripts/copy-vendor.mjs` | Copies `zeta.js` from node_modules into public |
| `scripts/wasm-pin.json` | Pinned WASM manifest (pin, source, file sizes + sha256) |
| `scripts/fetch-wasm.mjs` | Downloads + sha256-verifies the pinned WASM (`npm run fetch:wasm`) |
| `public/wasm/<pin>/` | Pinned `soffice.*` (git-ignored, produced by fetch) |
