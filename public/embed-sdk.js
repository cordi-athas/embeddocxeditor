// embeddocxeditor — host SDK
// Drop-in, dependency-free wrapper for talking to the editor embedded in an
// <iframe>. Plain ES module: import it directly from your host page.
//
//   import { DocxEditorClient } from 'https://YOUR-HOST/embed-sdk.js';
//
//   const editor = new DocxEditorClient(document.querySelector('iframe#editor'));
//   await editor.ready();
//   await editor.loadDocument(arrayBuffer, { name: 'rapor.docx' });
//   editor.on('change', () => markDirty());
//   const bytes = await editor.getDocx();   // Uint8Array (DOCX)
//   await editor.print();                   // → 'dialog' | 'tab' | 'download'
//
// The editor iframe must be served cross-origin-isolated (COOP/COEP) and the
// iframe tag should carry  allow="cross-origin-isolated".

const PROTOCOL_VERSION = 1;

/** The editor's own origin, derived from the iframe src (for targeting + validation). */
function editorOrigin(iframe) {
  try {
    return new URL(iframe.src, location.href).origin;
  } catch {
    return '*';
  }
}

export class DocxEditorClient {
  /**
   * @param {HTMLIFrameElement} iframe  the iframe hosting the editor
   * @param {{ targetOrigin?: string }} [opts]  override the editor origin to
   *   post to (default: derived from `iframe.src`). We never default to '*' so
   *   commands and document bytes aren't exposed to other origins.
   */
  constructor(iframe, { targetOrigin } = {}) {
    this._iframe = iframe;
    this._targetOrigin = targetOrigin || editorOrigin(iframe);
    this._seq = 0;
    this._pending = new Map(); // id -> { resolve, reject }
    this._listeners = { ready: [], change: [], clean: [], save: [], error: [] };
    this._isReady = false;
    this._queue = []; // commands issued before the editor signalled 'ready'
    this._readyPromise = new Promise((resolve) => (this._resolveReady = resolve));
    window.addEventListener('message', (e) => this._onMessage(e));
  }

  /** Resolves once the editor is up and ready to accept commands. */
  ready() {
    return this._readyPromise;
  }

  /**
   * Subscribe to an event. Returns this (chainable).
   *   'ready'  — editor booted
   *   'change' — document edited (debounced)
   *   'clean'  — document saved / freshly loaded
   *   'save'   — user pressed Ctrl/Cmd+S; host should persist (call getDocx)
   *   'error'  — something failed
   */
  on(event, cb) {
    (this._listeners[event] ||= []).push(cb);
    return this;
  }

  /**
   * Load a DOCX into the editor.
   * @param {ArrayBuffer|Uint8Array} data
   * @param {{ name?: string, readOnly?: boolean }} [opts]
   */
  loadDocument(data, { name = 'document.docx', readOnly = false } = {}) {
    const bytes =
      data instanceof ArrayBuffer
        ? data
        : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    // Not transferred: keep the caller's buffer usable (postMessage clones it).
    return this._request('load', { bytes, name, readOnly });
  }

  /** Get the current document as bytes in its native format (DOCX or XLSX). @returns {Promise<Uint8Array>} */
  async getDocx() {
    const { bytes } = await this._request('getDocx', {});
    return new Uint8Array(bytes);
  }

  /**
   * Get the current document in its native format, with type info.
   * @returns {Promise<{bytes: Uint8Array, mime: string, ext: string, kind: 'writer'|'calc'}>}
   */
  async getFile() {
    const { bytes, mime, ext, kind } = await this._request('getDocx', {});
    return { bytes: new Uint8Array(bytes), mime, ext, kind };
  }

  /** Replace the document with a new, blank one. `kind` = 'writer' (default) or 'calc'. */
  newDocument(kind) {
    return this._request('new', { kind });
  }

  /** Re-theme the editor, e.g. setTheme({ '--dxe-accent': '#2563eb' }). */
  setTheme(vars) {
    return this._request('setTheme', { vars });
  }

  /** Run a raw UNO command, e.g. dispatch('.uno:Bold'). */
  dispatch(uno, args) {
    return this._request('dispatch', { uno, args });
  }

  /** Inject plain text at the cursor. */
  insertText(text) {
    return this._request('insertText', { text });
  }

  /**
   * Print the current document. The editor renders it to PDF and hands that to
   * the browser's print dialog. No click gesture reaches the editor frame from
   * a host command, so WebKit/Safari cannot open a tab there and falls back to
   * downloading the PDF — the resolved value says which happened.
   * @returns {Promise<'dialog'|'tab'|'download'>}
   */
  async print() {
    const { method } = await this._request('print', {});
    return method;
  }

  /**
   * Fill template placeholders with data: every `{{key}}` (configurable via
   * `options.open`/`options.close`) is replaced with `data[key]`.
   * @returns {Promise<number>} total replacements made
   */
  async mergeFields(data, options) {
    const { count } = await this._request('mergeFields', { data, options });
    return count;
  }

  // ── internals ──────────────────────────────────────────────────────────
  _emit(event, ...args) {
    (this._listeners[event] || []).forEach((cb) => {
      try {
        cb(...args);
      } catch (err) {
        console.error(err);
      }
    });
  }

  _send(message, transfer = []) {
    this._iframe.contentWindow.postMessage(
      { source: 'dxe-host', v: PROTOCOL_VERSION, ...message },
      this._targetOrigin,
      transfer,
    );
  }

  _request(type, payload, transfer = []) {
    const id = ++this._seq;
    const promise = new Promise((resolve, reject) => this._pending.set(id, { resolve, reject }));
    const send = () => this._send({ id, type, payload }, transfer);
    if (this._isReady) send();
    else this._queue.push(send);
    return promise;
  }

  _onMessage(e) {
    if (e.source !== this._iframe.contentWindow) return; // only our editor frame
    if (this._targetOrigin !== '*' && e.origin !== this._targetOrigin) return; // …and its origin
    const d = e.data;
    if (!d || d.source !== 'dxe' || d.v !== PROTOCOL_VERSION) return;

    switch (d.type) {
      case 'ready':
        if (!this._isReady) {
          this._isReady = true;
          this._resolveReady();
          this._queue.splice(0).forEach((fn) => fn());
          this._emit('ready');
        }
        return;
      case 'change':
        this._emit('change');
        return;
      case 'clean':
        this._emit('clean');
        return;
      case 'save':
        this._emit('save');
        return;
      case 'error':
        this._emit('error', d.error);
        return;
      case 'result': {
        const waiter = this._pending.get(d.id);
        if (!waiter) return;
        this._pending.delete(d.id);
        if (d.ok) waiter.resolve(d.payload || {});
        else waiter.reject(new Error(d.error || 'Operation failed'));
        return;
      }
    }
  }
}
