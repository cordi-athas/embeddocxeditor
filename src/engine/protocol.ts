/**
 * Message protocol between the main thread (this app, owns the canvas + the
 * Emscripten virtual filesystem `FS`) and the LibreOffice-WASM worker thread
 * (`public/office_thread.js`, owns the `zetajs` / UNO objects).
 *
 * Files are exchanged through the shared Emscripten FS at `/tmp/office/...`:
 * the main thread writes the bytes, then tells the worker the path.
 */

/** A UNO dispatch parameter, e.g. { name: 'CharFontName', value: 'Carlito' }. */
export type DispatchArg = { name: string; value: boolean | number | string };

// Every request the main thread sends carries a unique `rid`; the worker echoes
// it on the matching reply (incl. `error`) so the engine can correlate replies
// to requests and reject the right one. Unsolicited worker messages
// (`thr_running`, `modified`, `format-state`, and boot-failure `error`) omit it.

/** Main thread → worker. */
export type MainToWorker = { rid?: number } & (
  | { cmd: 'new'; kind?: 'writer' | 'calc' } // blank Writer (default) or Calc doc
  | { cmd: 'open'; path: string; readOnly?: boolean }
  // filter: LibreOffice export filter (omit → DOCX). markClean: reset the modified
  // flag after a native save (true), but not after PDF export (false).
  | { cmd: 'save'; path: string; filter?: string; markClean?: boolean }
  | { cmd: 'dispatch'; uno: string; args?: DispatchArg[] } // run a UNO command
  | { cmd: 'find'; query: string; matchCase?: boolean; wholeWord?: boolean; backwards?: boolean }
  | { cmd: 'replaceAll'; query: string; replacement: string; matchCase?: boolean; wholeWord?: boolean }
  | { cmd: 'replaceNext'; query: string; replacement: string; matchCase?: boolean; wholeWord?: boolean }
  | { cmd: 'insertTable'; rows: number; cols: number }
  | { cmd: 'insertImage'; path: string }
  | { cmd: 'insertLink'; url: string; text?: string }
  | { cmd: 'insertText'; text: string } // inject plain text at the cursor
  // field/merge: replace every `${open}key${close}` with data[key]
  | { cmd: 'mergeFields'; data: Record<string, string>; open: string; close: string; matchCase?: boolean }
);

/** Worker → main thread. */
export type WorkerToMain = { rid?: number } & (
  | { cmd: 'thr_running' }          // worker booted, UNO Desktop ready
  | { cmd: 'doc_ready'; kind?: 'writer' | 'calc' } // a document was created/opened and shown
  | { cmd: 'saved'; path: string }  // export finished; bytes are at `path` in FS
  | { cmd: 'modified' }             // the document was edited (for dirty/autosave)
  | { cmd: 'find-result'; found: boolean }     // result of find / replaceNext
  | { cmd: 'replace-result'; count: number }   // result of replaceAll
  | { cmd: 'merge-result'; count: number }     // total replacements from mergeFields
  // toolbar state sync (unsolicited): boolean for toggles (Bold…), string/number
  // for value controls (CharFontName / FontHeight).
  | { cmd: 'format-state'; id: string; value: boolean | number | string }
  | { cmd: 'error'; message: string }
);
