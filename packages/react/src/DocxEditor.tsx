import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { CSSProperties } from 'react';
import { DocxEditorClient, type LoadOptions, type PrintOutcome } from './client';

export interface DocxEditorHandle {
  /** Current document as DOCX bytes. */
  getDocx(): Promise<Uint8Array>;
  loadDocument(data: ArrayBuffer | Uint8Array, opts?: LoadOptions): Promise<unknown>;
  newDocument(kind?: 'writer' | 'calc'): Promise<unknown>;
  /** Current document in its native format (DOCX or XLSX), with type info. */
  getFile(): Promise<{ bytes: Uint8Array; mime: string; ext: string; kind: 'writer' | 'calc' }>;
  setTheme(vars: Record<string, string>): Promise<unknown>;
  dispatch(uno: string, args?: unknown): Promise<unknown>;
  /** Inject plain text at the cursor. */
  insertText(text: string): Promise<unknown>;
  /** Print the current document; resolves with how the request was served. */
  print(): Promise<PrintOutcome>;
  /** Fill `{{key}}` placeholders with data; resolves to the replacement count. */
  mergeFields(
    data: Record<string, string>,
    options?: { open?: string; close?: string; matchCase?: boolean },
  ): Promise<number>;
  ready(): Promise<void>;
  /** Escape hatch to the underlying client. */
  readonly client: DocxEditorClient | null;
}

export interface DocxEditorProps {
  /** URL of the hosted editor app (the iframe src). Required. */
  src: string;
  /** Document to load. Loading happens whenever this reference changes. */
  document?: ArrayBuffer | Uint8Array;
  documentName?: string;
  readOnly?: boolean;
  /** Editor UI language ('en' default, or 'tr'). Appended to `src` as ?lang=. */
  lang?: 'en' | 'tr';
  /** CSS variables applied to the editor, e.g. {'--dxe-accent': '#2563eb'}. */
  theme?: Record<string, string>;
  onReady?: () => void;
  onChange?: () => void;
  onClean?: () => void;
  /** User pressed Ctrl/Cmd+S inside the editor — persist via ref.getDocx(). */
  onSave?: () => void;
  onError?: (message: string) => void;
  className?: string;
  style?: CSSProperties;
  /** iframe `allow` attribute (defaults enable cross-origin isolation). */
  allow?: string;
  title?: string;
}

export const DocxEditor = forwardRef<DocxEditorHandle, DocxEditorProps>(function DocxEditor(
  props,
  ref,
) {
  const {
    src,
    document: doc,
    documentName,
    readOnly,
    lang,
    theme,
    onReady,
    onChange,
    onClean,
    onSave,
    onError,
    className,
    style,
    allow = 'cross-origin-isolated; clipboard-write',
    title = 'DOCX editor',
  } = props;

  // Pass the language to the editor via the iframe URL (?lang=).
  const finalSrc = lang ? `${src}${src.includes('?') ? '&' : '?'}lang=${lang}` : src;

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const clientRef = useRef<DocxEditorClient | null>(null);
  // Latest callbacks, so we never need to re-create the client on prop changes.
  const cbs = useRef({ onReady, onChange, onClean, onSave, onError });
  cbs.current = { onReady, onChange, onClean, onSave, onError };
  const lastDoc = useRef<ArrayBuffer | Uint8Array | undefined>(undefined);

  const requireClient = (): DocxEditorClient => {
    if (!clientRef.current) throw new Error('DocxEditor is not mounted / ready yet.');
    return clientRef.current;
  };

  useImperativeHandle(
    ref,
    () => ({
      getDocx: () => requireClient().getDocx(),
      loadDocument: (data, opts) => requireClient().loadDocument(data, opts),
      newDocument: (kind) => requireClient().newDocument(kind),
      getFile: () => requireClient().getFile(),
      setTheme: (vars) => requireClient().setTheme(vars),
      dispatch: (uno, args) => requireClient().dispatch(uno, args),
      insertText: (text) => requireClient().insertText(text),
      print: () => requireClient().print(),
      mergeFields: (data, options) => requireClient().mergeFields(data, options),
      ready: () => requireClient().ready(),
      get client() {
        return clientRef.current;
      },
    }),
    [],
  );

  // Create / tear down the client alongside the iframe.
  useEffect(() => {
    if (typeof window !== 'undefined' && !window.crossOriginIsolated) {
      console.warn(
        '[DocxEditor] This page is not cross-origin isolated; the editor ' +
          '(SharedArrayBuffer) may not work. Add the COOP/COEP headers to the host page (see README).',
      );
    }
    const iframe = iframeRef.current;
    if (!iframe) return;

    const client = new DocxEditorClient(iframe);
    clientRef.current = client;

    client.on('ready', () => cbs.current.onReady?.());
    client.on('change', () => cbs.current.onChange?.());
    client.on('clean', () => cbs.current.onClean?.());
    client.on('save', () => cbs.current.onSave?.());
    client.on('error', (m: string) => cbs.current.onError?.(m));

    return () => {
      client.destroy();
      clientRef.current = null;
      lastDoc.current = undefined;
    };
  }, [finalSrc]);

  // Load whenever the `document` prop reference changes (after ready).
  useEffect(() => {
    const client = clientRef.current;
    if (!client || !doc || doc === lastDoc.current) return;
    lastDoc.current = doc;
    client
      .ready()
      .then(() => client.loadDocument(doc, { name: documentName, readOnly }))
      .catch((e) => cbs.current.onError?.(String((e as Error)?.message ?? e)));
  }, [doc, documentName, readOnly]);

  // Apply theme changes (after ready).
  useEffect(() => {
    const client = clientRef.current;
    if (!client || !theme) return;
    client
      .ready()
      .then(() => client.setTheme(theme))
      .catch(() => {});
  }, [theme]);

  return (
    <iframe
      ref={iframeRef}
      src={finalSrc}
      allow={allow}
      title={title}
      className={className}
      style={{ border: 0, width: '100%', height: '100%', ...style }}
    />
  );
});
