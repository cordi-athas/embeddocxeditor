# Third-Party Notices

This project's own wrapper code (engine, UI, embed bridge, React package) is
**MIT-licensed** — see [`LICENSE`](LICENSE). It bundles and/or redistributes the
third-party software below, under their respective licenses. Full license texts
are in the [`licenses/`](licenses/) directory.

Legal review is recommended before distribution.

---

## LibreOffice (WebAssembly build) — MPL-2.0 / LGPL-3.0+

The document/rendering engine is **LibreOffice**, compiled to WebAssembly and
redistributed as `public/wasm/<pin>/soffice.{js,wasm,data,…}` (and copied into
`dist/wasm/` on build). The pinned build is recorded in
[`scripts/wasm-pin.json`](scripts/wasm-pin.json).

- Copyright © The Document Foundation and contributors.
- License: **Mozilla Public License 2.0** and **GNU Lesser General Public License
  v3.0 or later** (LibreOffice is mixed MPL-2.0 / LGPL-3.0+).
  Texts: [`licenses/MPL-2.0.txt`](licenses/MPL-2.0.txt),
  [`licenses/LGPL-3.0.txt`](licenses/LGPL-3.0.txt),
  [`licenses/GPL-3.0.txt`](licenses/GPL-3.0.txt) (the LGPL builds on the GPL).
- Project: <https://www.libreoffice.org/>
- WebAssembly build (ZetaOffice) by allotropia: <https://zetaoffice.net/> ·
  <https://github.com/allotropia/zetajs>

**Corresponding source (LGPL/GPL).** The pinned payload is the unmodified upstream
LibreOffice/ZetaOffice WebAssembly build (frozen by sha256 in `scripts/wasm-pin.json`;
its `source` field records the origin URL). Corresponding source for LibreOffice:
<https://www.libreoffice.org/about-us/source-code/> · <https://git.libreoffice.org/core>.
This serves as the written offer of source for the LGPL-3.0 components.

**Replacing the LGPL library (LGPL).** The library is loaded as a separate,
replaceable WebAssembly payload. You can substitute a different build by changing
`SOFFICE_BASE_URL` in `src/engine/config.ts` (or re-pinning via
`scripts/wasm-pin.json` + `npm run fetch:wasm`) to point at another
`soffice.{js,wasm,data}` set. The wrapper neither modifies nor statically links it.

---

## zetajs — MIT

The UNO/JavaScript bridge to LibreOffice-WASM, vendored into
`public/vendor/zetajs/` by `npm run copy:vendor`.

- Copyright © 2024 allotropia software GmbH and contributors.
- License: **MIT** — shipped at `public/vendor/zetajs/LICENSE`.
- Project: <https://github.com/allotropia/zetajs>

---

## Qt — LGPL-3.0

The LibreOffice WebAssembly build uses the **Qt** framework (Qt5) for its
rendering backend; Qt is included within the LibreOffice payload above.

- Copyright © The Qt Company Ltd and contributors.
- License: **GNU Lesser General Public License v3.0** —
  [`licenses/LGPL-3.0.txt`](licenses/LGPL-3.0.txt).
- Project: <https://www.qt.io/> · source: <https://download.qt.io/>

---

> **Scope.** The `@embeddocx/react` npm package ships **only** the React wrapper
> (MIT) and contains no LibreOffice — it embeds a separately-deployed editor via
> an `<iframe>`. The LibreOffice/Qt notices above apply to deployments of the
> **editor web app** (which bundle the WebAssembly payload), not to the npm
> package itself.
