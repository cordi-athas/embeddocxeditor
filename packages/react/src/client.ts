// Framework-agnostic client for talking to the embedded editor over postMessage.
// (Same wire protocol as the editor's public/embed-sdk.js, v1.) The React
// <DocxEditor> component wraps this, but you can use it directly too.

const PROTOCOL_VERSION = 1;

/** The editor's own origin, derived from the iframe src (for targeting + validation). */
function editorOrigin(iframe: HTMLIFrameElement): string {
  try {
    return new URL(iframe.src, location.href).origin;
  } catch {
    return '*';
  }
}

export interface LoadOptions {
  name?: string;
  readOnly?: boolean;
}

export type DocxEditorEvent = 'ready' | 'change' | 'clean' | 'save' | 'error';

type Pending = { resolve: (value: any) => void; reject: (error: Error) => void };

export class DocxEditorClient {
  private readonly iframe: HTMLIFrameElement;
  private readonly targetOrigin: string;
  private seq = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners: Record<string, Array<(...args: any[]) => void>> = {
    ready: [],
    change: [],
    clean: [],
    save: [],
    error: [],
  };
  private isReady = false;
  private queue: Array<() => void> = [];
  private resolveReady!: () => void;
  private readonly readyPromise: Promise<void>;
  private readonly onMessage: (e: MessageEvent) => void;

  constructor(iframe: HTMLIFrameElement, opts: { targetOrigin?: string } = {}) {
    this.iframe = iframe;
    // Target (and validate) the editor's own origin, derived from the iframe
    // src. Never '*', so commands/document bytes aren't exposed to other origins.
    this.targetOrigin = opts.targetOrigin ?? editorOrigin(iframe);
    this.readyPromise = new Promise((resolve) => (this.resolveReady = resolve));
    this.onMessage = (e) => this.handle(e);
    window.addEventListener('message', this.onMessage);
  }

  /** Resolves once the editor is up and accepting commands. */
  ready(): Promise<void> {
    return this.readyPromise;
  }

  on(event: DocxEditorEvent, cb: (...args: any[]) => void): this {
    (this.listeners[event] ||= []).push(cb);
    return this;
  }

  off(event: DocxEditorEvent, cb: (...args: any[]) => void): this {
    this.listeners[event] = (this.listeners[event] || []).filter((f) => f !== cb);
    return this;
  }

  /** Load a DOCX from bytes provided by the host. */
  loadDocument(data: ArrayBuffer | Uint8Array, opts: LoadOptions = {}): Promise<unknown> {
    const bytes =
      data instanceof ArrayBuffer
        ? data
        : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    return this.request('load', {
      bytes,
      name: opts.name ?? 'document.docx',
      readOnly: !!opts.readOnly,
    });
  }

  /** Get the current document as bytes in its native format (DOCX or XLSX). */
  async getDocx(): Promise<Uint8Array> {
    const result = await this.request('getDocx', {});
    return new Uint8Array(result.bytes);
  }

  /** Get the current document in its native format, with type info. */
  async getFile(): Promise<{ bytes: Uint8Array; mime: string; ext: string; kind: 'writer' | 'calc' }> {
    const r = await this.request('getDocx', {});
    return { bytes: new Uint8Array(r.bytes), mime: r.mime, ext: r.ext, kind: r.kind };
  }

  /** Replace the document with a new, blank one — 'writer' (default) or 'calc'. */
  newDocument(kind?: 'writer' | 'calc'): Promise<unknown> {
    return this.request('new', { kind });
  }

  setTheme(vars: Record<string, string>): Promise<unknown> {
    return this.request('setTheme', { vars });
  }

  dispatch(uno: string, args?: unknown): Promise<unknown> {
    return this.request('dispatch', { uno, args });
  }

  /** Inject plain text at the cursor. */
  insertText(text: string): Promise<unknown> {
    return this.request('insertText', { text });
  }

  /**
   * Fill template placeholders with data: every `{{key}}` (configurable via
   * `options.open`/`options.close`) is replaced with `data[key]`.
   * @returns total replacements made
   */
  async mergeFields(
    data: Record<string, string>,
    options: { open?: string; close?: string; matchCase?: boolean } = {},
  ): Promise<number> {
    const r = await this.request('mergeFields', { data, options });
    return (r as { count?: number }).count ?? 0;
  }

  /** Remove the message listener. Call when unmounting. */
  destroy(): void {
    window.removeEventListener('message', this.onMessage);
    this.pending.clear();
    this.queue = [];
  }

  // ── internals ──────────────────────────────────────────────────────────
  private emit(event: string, ...args: any[]): void {
    (this.listeners[event] || []).forEach((cb) => {
      try {
        cb(...args);
      } catch (err) {
        console.error(err);
      }
    });
  }

  private send(message: Record<string, unknown>, transfer: Transferable[] = []): void {
    this.iframe.contentWindow?.postMessage(
      { source: 'dxe-host', v: PROTOCOL_VERSION, ...message },
      this.targetOrigin,
      transfer,
    );
  }

  private request(type: string, payload: unknown, transfer: Transferable[] = []): Promise<any> {
    const id = ++this.seq;
    const promise = new Promise<any>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    const fire = () => this.send({ id, type, payload }, transfer);
    if (this.isReady) fire();
    else this.queue.push(fire);
    return promise;
  }

  private handle(e: MessageEvent): void {
    if (e.source !== this.iframe.contentWindow) return; // only our editor frame
    if (this.targetOrigin !== '*' && e.origin !== this.targetOrigin) return; // …and its origin
    const d = e.data;
    if (!d || d.source !== 'dxe' || d.v !== PROTOCOL_VERSION) return;

    switch (d.type) {
      case 'ready':
        if (!this.isReady) {
          this.isReady = true;
          this.resolveReady();
          this.queue.splice(0).forEach((fn) => fn());
          this.emit('ready');
        }
        return;
      case 'change':
        this.emit('change');
        return;
      case 'clean':
        this.emit('clean');
        return;
      case 'save':
        this.emit('save');
        return;
      case 'error':
        this.emit('error', d.error);
        return;
      case 'result': {
        const waiter = this.pending.get(d.id);
        if (!waiter) return;
        this.pending.delete(d.id);
        if (d.ok) waiter.resolve(d.payload || {});
        else waiter.reject(new Error(d.error || 'Operation failed'));
        return;
      }
    }
  }
}
