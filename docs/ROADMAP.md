# Roadmap

## Phase 0 — De-risk spike ✅ (done)

Three things to prove before committing to the whole project. Acceptance criteria — all verified:

- [x] **Boot & offline:** `npm run dev` → the editor opens. On a second load with the network off (DevTools → Offline) it still opens (SW cache).
- [x] **Render fidelity:** a *complex* real DOCX with tables, numbering, headers/footers and images opens and visually matches its appearance in Word.
- [x] **Round-trip:** open → edit → "Save DOCX" → reopen. No format/content loss; the file opens cleanly in Word.

Passing these three validates the "pure browser + 1:1 parity" goal.

## Phase 1 — Editor foundation ✅

- [x] Error/status UI, loading spinner (overlay above the canvas).
- [x] Document close / "is-modified" tracking (`Modified` state from UNO).
- [x] PDF export (`storeToURL`, `writer_pdf_Export`).
- [x] Keyboard/focus and high-DPI/zoom behavior polish.

## Phase 2 — Turning it into a "purpose-built package"

- [x] **Internationalization (i18n):** UI English by default; EN/TR. At the code level `setLang()` / `DEFAULT_LANG`, plus the `?lang=tr` URL parameter and the React `lang` prop ([src/i18n.ts](../src/i18n.ts)). Adding a language is a single dictionary entry.
- [x] **Host integration API (embed):** iframe postMessage bridge (`src/embed-host.ts`) + a dependency-free host SDK (`public/embed-sdk.js`: `ready`/`loadDocument`/`getDocx`/`newDocument`/`setTheme`/`dispatch` + `on('change'|'ready'|'clean'|'save'|'error')`) + a working example host (`packages/react/example`). Documents pass as ArrayBuffer; `change` is suppressed right after load. **Origin-safe** (main README → Security).
- [x] **Ctrl/Cmd+S interception + dirty + beforeunload:** Ctrl+S (and Ctrl+Shift+S) are caught before Qt (a capture-phase listener registered at module load) → a `save` event to the host when embedded, a download when standalone. The `/home/web_user` gotcha is closed. Unsaved-change tracking (`change`/`clean` events + an amber dot in the toolbar) and a tab-close warning were added.
- [x] **Event API:** `onReady`, `onChange`, `onClean`, `onSave`, `onError` — exposed on the React `<DocxEditor>` and on `DocxEditorClient` (`on(...)`).
- [x] **React package** (`embeddocx-react`): the iframe-wrapping `<DocxEditor>` component + `DocxEditorClient` + tsup build (ESM+CJS) + a working example (`packages/react/example`); published to npm (MIT). The editor sends `Cross-Origin-Resource-Policy: cross-origin` for cross-origin embedding.
- [x] **Programmatic content API:** `insertText` (inject text at the cursor) + `mergeFields` (fill `{{key}}` template placeholders with host-supplied data, returns the replacement count) — wired through the engine, embed bridge, host SDK, and React handle. Turns the editor into a programmable document engine. (Find/replace was already done — see Phase 3 / Phase B.)
- [ ] **Multi-format (XLSX / Calc):** _Phase A done_ — open/new/save **XLSX** (Calc), document-kind detection (`src/engine/formats.ts`, model `supportsService`), kind-aware native + PDF export filters, and `newDocument(kind)` / `getFile()` across engine · embed bridge · SDK · React; verified open/save round-trip + kind detection. _Phase B pending_ — hide LibreOffice's native **Calc chrome** (its toolbar/formula bar/sheet tabs still show: `hideAllToolbars` targets only `WriterWindowState`), a type-aware toolbar, and **cell-targeted** `insertText`/`mergeFields` for Calc (current ones use Writer `XText`).
- [ ] **Detect external opens:** notice documents opened via LibreOffice's Start Center / drag-drop using a UNO frame/component listener, and update the toolbar state + filename.
- [ ] **Split `ZetaDocxEditor` into a standalone npm package** (a UI-independent core engine).
- [ ] **Vue wrapper** (on the same SDK).

## Phase 3 — Custom UI ✅ (foundation done)

Your own UI instead of LibreOffice's Qt UI:

- [x] Menubar/toolbars/sidebar/statusbar hidden via UNO (`public/office_thread.js`).
- [x] Our own toolbar dispatches `.uno:Bold/Italic/Underline`, alignment, bullets, undo/redo.
- [x] Active/inactive button sync via `XStatusListener` (Start Center skipped by creating a blank doc after boot).
- [x] **Rich toolbar (Phase A):** a consistent inline **SVG icon set** (~28 icons, dependency-free, `currentColor` → accent when active) + paragraph style/font/size, color/highlight, bold/italic/strike, **sub/superscript, clear formatting, indent ±, line-spacing menu, ¶ formatting marks, spell check, zoom ±, PDF export**. All via `.uno` dispatch / state-sync; no dialog-opening commands.
- [x] **Phase B — Find & Replace:** our own search bar (Ctrl+F, next/prev, Aa/word, Replace/All) + programmatic UNO (`createSearchDescriptor`/`findFirst`/`replaceAll`) — without opening LibreOffice's dialog.
- [x] **Adaptive toolbar (narrow embeds):** as width shrinks, groups fold into labeled dropdowns ("Paragraph ▾"); very narrow → icon pills + an overflow "⋯" menu (with labeled VIEW/INSERT/PARAGRAPH sections). Single row, fixed height, all tools reachable at any width (`src/adaptive-toolbar.ts`).
- [x] **Phase C — Insert:** table (row×column grid picker), image (own file picker → GraphicProvider, sized via SizePixel), hyperlink (URL/text form → sanitized HyperLinkURL) — all with their own mini-UI + programmatic UNO, no dialogs.
- [x] Packaged as a React component (`<DocxEditor />`); a Vue wrapper is still pending (Phase 2).

## Phase 4 — Production hardening

- [x] WASM version-pin + same-origin self-host (`public/wasm/<pin>/`, sha256-verified `scripts/fetch-wasm.mjs` + `wasm-pin.json`; `*.wasm`/`*.data` Brotli, `Content-Encoding: br`) → offline guarantee + COEP simplification + reproducible builds.
- [x] Robustness: request-id correlation + per-op timeouts (`src/engine/pending.ts`), boot-failure error UI + `crossOriginIsolated` guard, SW corruption-safety (never cache a truncated payload).
- [x] License (MIT wrapper) + redistribution compliance artifacts (LICENSE, THIRD-PARTY-NOTICES.md, `licenses/`); a legal review is still recommended before wide distribution.
- [ ] Bundle/loading optimization (cache headers, compression, pre-warming).
- [ ] Large-document memory profile; memory64/limit tests if needed.
- [ ] OPFS/IndexedDB session recovery and autosave.

## Known risks (track)

- **Download size (~52 MB):** acceptable for the target audience? If not → the Tauri (desktop) door is open.
- **COOP/COEP:** complicates the third-party embedding scenario.
- **WASM memory ceiling:** very large documents.
- **Mobile:** large WASM + memory may be tough on mobile.
