import { SOFFICE_BASE_URL, ZETA_JS_URL, WORKER_URL } from './config';
import type { DispatchArg, MainToWorker, WorkerToMain } from './protocol';
import { PendingRequests } from './pending';
import { safeLinkUrl } from './url-safe';

/**
 * Operation timeouts (ms) — backstops so a crashed or silent worker can never
 * hang a promise (and the UI) forever. Generous, so slow-but-real operations on
 * large documents don't trip them; the goal is catching hangs, not enforcing SLAs.
 */
const BOOT_TIMEOUT_MS = 120_000;
const OP_TIMEOUT_MS = 60_000;
const FIND_TIMEOUT_MS = 30_000;

declare global {
  // Globals injected by the LibreOffice / Emscripten runtime (soffice.js).
  interface Window {
    Module?: Record<string, unknown> & { uno_main?: Promise<MessagePort> };
    FS?: {
      mkdir(path: string): void;
      writeFile(path: string, data: Uint8Array): void;
      readFile(path: string): Uint8Array;
    };
  }
}

/** Directory inside the Emscripten virtual FS used to hand files to LibreOffice. */
const OFFICE_DIR = '/tmp/office';

export interface ZetaEngineOptions {
  /** The <canvas id="qtcanvas"> LibreOffice renders into. */
  canvas: HTMLCanvasElement;
  /** Optional status callback for UI feedback. */
  onStatus?: (status: string) => void;
}

export interface FindOpts {
  matchCase?: boolean;
  wholeWord?: boolean;
  backwards?: boolean;
}

/**
 * ZetaDocxEditor — a small, framework-agnostic wrapper around ZetaJS
 * (LibreOffice compiled to WebAssembly).
 *
 * This is the seed of your own editor package: the public API
 * (`boot` / `newDocument` / `openDocx` / `saveDocx`) hides every ZetaJS, UNO
 * and Emscripten detail. Swap the UI, wrap it in React/Vue, or extend the
 * worker protocol without touching callers.
 */
export class ZetaDocxEditor {
  private readonly canvas: HTMLCanvasElement;
  private readonly onStatus: (s: string) => void;
  private port: MessagePort | null = null;
  private booted = false;
  private readonly pending = new PendingRequests();
  private formatStateCb: ((id: string, value: boolean | number | string) => void) | null = null;
  private changeCb: (() => void) | null = null;
  private changeTimer: ReturnType<typeof setTimeout> | null = null;
  private suppressChangeUntil = 0;
  private imgSeq = 0;

  constructor(opts: ZetaEngineOptions) {
    this.canvas = opts.canvas;
    this.onStatus = opts.onStatus ?? (() => {});
  }

  /** Load LibreOffice WASM and resolve once the worker thread is ready. */
  async boot(): Promise<void> {
    if (this.booted) return;
    // The app shows its own loading overlay during boot; the engine doesn't push
    // status-bar copy (which would leak un-localized text into the toolbar).

    // Resolve the configured base to an ABSOLUTE URL. SOFFICE_BASE_URL may be
    // root-relative (default: '/wasm/<pin>/'), but Emscripten pthread workers are
    // created from a `blob:` URL, where a root-relative path has no resolvable
    // base — `importScripts('/wasm/.../soffice.js')` throws "URL is invalid". An
    // absolute, same-origin URL works in both the main thread and those workers.
    const baseAbs = SOFFICE_BASE_URL === '' ? '' : new URL(SOFFICE_BASE_URL, location.href).href;

    const Module: Record<string, unknown> = {
      canvas: this.canvas,
      // [0] = zeta.js UNO wrapper, [1] = our worker thread script.
      uno_scripts: [ZETA_JS_URL, WORKER_URL],
      locateFile: (path: string, prefix: string) => (prefix || baseAbs) + path,
    };
    if (baseAbs !== '') {
      // Tell the Emscripten pthread workers where to import soffice.js from.
      Module.mainScriptUrlOrBlob = new Blob(
        [`importScripts('${baseAbs}soffice.js');`],
        { type: 'text/javascript' },
      );
    }
    window.Module = Module;

    // Register the readiness waiter BEFORE the worker can post 'thr_running'.
    const ready = this.pending.registerMatch(
      (m) => m.cmd === 'thr_running',
      BOOT_TIMEOUT_MS,
      'boot',
    );

    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = baseAbs + 'soffice.js';
      script.onerror = () => reject(new Error('Failed to load soffice.js: ' + script.src));
      script.onload = () => {
        // uno_main resolves to the main-thread end of the MessageChannel.
        window.Module!.uno_main!
          .then((port: MessagePort) => {
            this.port = port;
            port.onmessage = (e: MessageEvent<WorkerToMain>) => this.handleMessage(e.data);
            resolve();
          })
          .catch(reject);
      };
      document.body.appendChild(script);
    });

    await ready;
    this.booted = true;
    this.observeResize();
  }

  /** Create a new, blank Writer document. */
  async newDocument(): Promise<void> {
    await this.request({ cmd: 'new' }, OP_TIMEOUT_MS, 'new document');
    this.afterDocReady();
  }

  /** Open a .docx / .odt File into the editor. */
  async openDocx(file: File): Promise<void> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await this.openDocxBytes(bytes, file.name);
  }

  /** Open a document from raw bytes (e.g. provided by a host app via embed API). */
  async openDocxBytes(
    bytes: Uint8Array,
    name = 'document.docx',
    opts: { readOnly?: boolean } = {},
  ): Promise<void> {
    const path = `${OFFICE_DIR}/${name}`;
    this.fs.mkdirSafe(OFFICE_DIR);
    this.fs.write(path, bytes);
    await this.request(
      { cmd: 'open', path, readOnly: opts.readOnly },
      OP_TIMEOUT_MS,
      'open document',
    );
    this.afterDocReady();
  }

  /** Export the current document as DOCX bytes. */
  getDocxBytes(filename = 'document.docx'): Promise<Uint8Array> {
    return this.exportBytes(filename);
  }

  /** Export the current document as a PDF Blob. */
  async exportPdf(filename = 'document.pdf'): Promise<Blob> {
    const bytes = await this.exportBytes(filename, 'writer_pdf_Export');
    return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
  }

  /** Export via a LibreOffice filter (default = DOCX). */
  private async exportBytes(filename: string, filter?: string): Promise<Uint8Array> {
    const path = `${OFFICE_DIR}/${filename}`;
    this.fs.mkdirSafe(OFFICE_DIR);
    // Suppress the modify-event noise the export round-trip emits, otherwise a
    // save would immediately mark the document "dirty" again.
    this.suppressChangeUntil = Number.MAX_SAFE_INTEGER;
    this.clearChangeTimer();
    try {
      const done = (await this.request(
        { cmd: 'save', path, filter },
        OP_TIMEOUT_MS,
        'save',
      )) as Extract<WorkerToMain, { cmd: 'saved' }>;
      // Copy into a fresh ArrayBuffer-backed array: under cross-origin isolation
      // FS may hand back a SharedArrayBuffer-backed view (not Blob/transfer-safe).
      return new Uint8Array(this.fs.read(done.path));
    } finally {
      this.suppressChangeUntil = Date.now() + 600; // brief tail for late events
      this.clearChangeTimer();
    }
  }

  private clearChangeTimer(): void {
    if (this.changeTimer != null) {
      clearTimeout(this.changeTimer);
      this.changeTimer = null;
    }
  }

  /** Export the current document as a DOCX Blob (convenience over getDocxBytes). */
  async saveDocx(filename = 'untitled.docx'): Promise<Blob> {
    const bytes = await this.getDocxBytes(filename);
    // Re-wrap in a guaranteed ArrayBuffer-backed view for Blob (TS rejects a
    // possibly-SharedArrayBuffer-backed Uint8Array as a BlobPart).
    return new Blob([new Uint8Array(bytes)], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  }

  /**
   * Run a UNO command in the editor, e.g. `.uno:Bold`, `.uno:Undo`,
   * `.uno:CenterPara`. Fire-and-forget — state changes come back via
   * `onFormatState` for the commands the worker subscribes to.
   */
  dispatch(unoCommand: string, args?: DispatchArg[]): void {
    this.send({ cmd: 'dispatch', uno: unoCommand, args });
  }

  /** Find the next (or previous) match, select it, and scroll to it. */
  async find(query: string, opts: FindOpts = {}): Promise<boolean> {
    const r = (await this.request(
      {
        cmd: 'find',
        query,
        matchCase: opts.matchCase,
        wholeWord: opts.wholeWord,
        backwards: opts.backwards,
      },
      FIND_TIMEOUT_MS,
      'find',
    )) as Extract<WorkerToMain, { cmd: 'find-result' }>;
    return r.found;
  }

  /** Replace every match. Returns the number of replacements. */
  async replaceAll(query: string, replacement: string, opts: FindOpts = {}): Promise<number> {
    const r = (await this.request(
      {
        cmd: 'replaceAll',
        query,
        replacement,
        matchCase: opts.matchCase,
        wholeWord: opts.wholeWord,
      },
      FIND_TIMEOUT_MS,
      'replace all',
    )) as Extract<WorkerToMain, { cmd: 'replace-result' }>;
    return r.count;
  }

  /** Replace the current match (if any) and move to the next. Returns whether a next match exists. */
  async replaceNext(query: string, replacement: string, opts: FindOpts = {}): Promise<boolean> {
    const r = (await this.request(
      {
        cmd: 'replaceNext',
        query,
        replacement,
        matchCase: opts.matchCase,
        wholeWord: opts.wholeWord,
      },
      FIND_TIMEOUT_MS,
      'replace',
    )) as Extract<WorkerToMain, { cmd: 'find-result' }>;
    return r.found;
  }

  /**
   * Register a callback for formatting state changes. Used to keep custom
   * toolbar controls in sync: `value` is a boolean for toggle commands
   * (Bold, alignment, …) or a string/number for value commands (CharFontName,
   * FontHeight). `id` is the bare command id without the `.uno:` prefix.
   */
  onFormatState(cb: (id: string, value: boolean | number | string) => void): void {
    this.formatStateCb = cb;
  }

  /**
   * Register a callback fired (debounced) when the document is edited. Use for
   * dirty-state tracking / autosave. Suppressed briefly right after load so a
   * freshly opened document doesn't immediately report as "changed".
   */
  onChange(cb: () => void): void {
    this.changeCb = cb;
  }

  /** Insert a table with the given dimensions at the cursor. */
  insertTable(rows: number, cols: number): void {
    this.send({ cmd: 'insertTable', rows, cols });
  }

  /** Insert an image (from a picked / host-provided File) at the cursor. */
  async insertImage(file: File): Promise<void> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const safe = file.name.replace(/[^\w.\-]+/g, '_');
    const path = `${OFFICE_DIR}/img_${++this.imgSeq}_${safe}`;
    this.fs.mkdirSafe(OFFICE_DIR);
    this.fs.write(path, bytes);
    this.send({ cmd: 'insertImage', path });
  }

  /** Insert a hyperlink (applied to the selection, or inserted as text).
   *  The URL is sanitized — only http(s)/mailto/tel and relative URLs are
   *  allowed — so a `javascript:`/`data:` link can't be stored in the document. */
  insertLink(url: string, text?: string): void {
    const safe = safeLinkUrl(url);
    if (!safe) throw new Error(`Unsafe or empty link URL: ${url}`);
    this.send({ cmd: 'insertLink', url: safe, text });
  }

  /** Ask LibreOffice to resize its window to the current canvas size. */
  requestResize(): void {
    window.dispatchEvent(new Event('resize'));
  }

  // ---------------- internals ----------------

  private afterDocReady(): void {
    // Qt sizes its window at init; nudge it to fill the (possibly larger) canvas.
    this.requestResize();
    setTimeout(() => this.requestResize(), 300);
    // Ignore the modify events that loading/creating a document itself emits.
    this.suppressChangeUntil = Date.now() + 800;
  }

  private observeResize(): void {
    // Make the editor follow its embed container's size (full-width, responsive).
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this.requestResize()).observe(this.canvas);
    }
  }

  private get fs() {
    const FS = window.FS;
    if (!FS) throw new Error('Emscripten FS not ready — call boot() first.');
    return {
      mkdirSafe: (p: string) => {
        try {
          FS.mkdir(p);
        } catch {
          /* already exists */
        }
      },
      write: (p: string, d: Uint8Array) => FS.writeFile(p, d),
      read: (p: string) => FS.readFile(p),
    };
  }

  /** Fire-and-forget command (no reply awaited). Still carries a rid so a
   *  worker-side failure surfaces as an orphan error, not a fatal one. */
  private send(msg: MainToWorker): void {
    if (!this.port) throw new Error('Worker not ready — call boot() first.');
    this.port.postMessage({ ...msg, rid: this.pending.nextRid() });
  }

  /** Send a request and await its correlated reply, with a timeout backstop. */
  private request(msg: MainToWorker, timeoutMs: number, label: string): Promise<WorkerToMain> {
    if (!this.port) return Promise.reject(new Error('Worker not ready — call boot() first.'));
    const rid = this.pending.nextRid();
    const reply = this.pending.register(rid, timeoutMs, label) as Promise<WorkerToMain>;
    this.port.postMessage({ ...msg, rid });
    return reply;
  }

  private handleMessage(m: WorkerToMain): void {
    if (m.cmd === 'format-state') {
      this.formatStateCb?.(m.id, m.value); // unsolicited; not part of request/response
      return;
    }
    if (m.cmd === 'modified') {
      if (Date.now() < this.suppressChangeUntil) return; // ignore load-time noise
      if (this.changeTimer != null) return; // debounce a burst of edits into one
      this.changeTimer = setTimeout(() => {
        this.changeTimer = null;
        this.changeCb?.();
      }, 250);
      return;
    }
    // Correlate to the awaiting request (resolve / reject by rid). A rid-less
    // error is a worker/runtime failure → rejects everything pending.
    const outcome = this.pending.handle(m);
    if (outcome === 'fatal' || outcome === 'orphan-error') {
      this.onStatus('Error: ' + (m as Extract<WorkerToMain, { cmd: 'error' }>).message);
    }
  }
}
