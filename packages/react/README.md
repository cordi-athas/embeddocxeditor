# embeddocx-react

React component for embedding the offline, full-fidelity **DOCX editor** (LibreOffice
compiled to WebAssembly). Thin wrapper around an `<iframe>` that hosts the editor +
a typed client — the heavy WASM engine stays isolated inside the iframe.

## Install

```bash
npm i embeddocx-react
```

`react` is a peer dependency. You also need the **editor app hosted somewhere** (the
`src` URL) — deploy the `embeddocxeditor` app and point `src` at it.

## Usage

```tsx
import { DocxEditor, type DocxEditorHandle } from 'embeddocx-react';
import { useRef, useState } from 'react';

export function Editor() {
  const ref = useRef<DocxEditorHandle>(null);
  const [dirty, setDirty] = useState(false);

  return (
    <div style={{ height: 600 }}>
      <button
        onClick={async () => {
          const bytes = await ref.current!.getDocx(); // Uint8Array (DOCX)
          await fetch('/api/save', { method: 'POST', body: bytes });
          setDirty(false);
        }}
      >
        Save {dirty ? '●' : ''}
      </button>

      <DocxEditor
        ref={ref}
        src="https://editor.example.com"   // your hosted editor app
        onChange={() => setDirty(true)}
        onSave={async () => {               // user pressed Ctrl/Cmd+S in the editor
          const bytes = await ref.current!.getDocx();
          await fetch('/api/save', { method: 'POST', body: bytes });
          setDirty(false);
        }}
        theme={{ '--dxe-accent': '#2563eb' }}
        style={{ height: '100%' }}
      />
    </div>
  );
}
```

## ⚠️ Cross-origin isolation is required

The editor uses WebAssembly threads (`SharedArrayBuffer`), so **the page that embeds
it must be cross-origin isolated**. Send these headers from *your* app's server:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp        # or: credentialless
```

A bundler dev server / npm package can't set these for you. Examples:

```ts
// Vite (vite.config.ts)
export default { server: { headers: {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
} } };
```

```js
// Next.js (next.config.js) → headers()
{ source: '/:path*', headers: [
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
] }
```

```js
// Express
app.use((_, res, next) => {
  res.set('Cross-Origin-Opener-Policy', 'same-origin');
  res.set('Cross-Origin-Embedder-Policy', 'require-corp');
  next();
});
```

If the page isn't isolated, the component logs a warning and the editor won't boot.

## API

### `<DocxEditor>` props

| Prop | Type | Notes |
|------|------|-------|
| `src` | `string` | **Required.** URL of the hosted editor app. |
| `document` | `ArrayBuffer \| Uint8Array` | Loaded whenever the reference changes. |
| `documentName` | `string` | File name for the loaded document. |
| `readOnly` | `boolean` | Open in view mode. |
| `lang` | `'en' \| 'tr'` | Editor UI language (default `en`); appended to `src` as `?lang=`. |
| `theme` | `Record<string,string>` | CSS variables (`--dxe-accent`, …). |
| `onReady` / `onChange` / `onClean` / `onSave` / `onError` | callbacks | Lifecycle + edit events. |
| `className` / `style` / `allow` / `title` | — | Passed to the iframe. |

### Ref handle (`DocxEditorHandle`)

`getDocx()` · `loadDocument(data, opts?)` · `newDocument()` · `setTheme(vars)` ·
`dispatch(uno, args?)` · `ready()` · `client`

### Non-React usage

`DocxEditorClient` is exported too, for vanilla / other frameworks:

```ts
import { DocxEditorClient } from 'embeddocx-react';
const client = new DocxEditorClient(document.querySelector('iframe')!);
await client.ready();
await client.loadDocument(bytes, { name: 'report.docx' });
```

## Security (cross-origin)

The bridge is origin-safe out of the box: the client posts to — and validates
events from — the **editor's own origin** (derived from `src`), and the editor
only accepts commands from its embedder, replying document bytes to that origin
only (never `*`). To pin an explicit allowlist, append `?dxeParentOrigin=<your-origin>`
to `src`. See the main project README → "Güvenlik (cross-origin / postMessage)".
