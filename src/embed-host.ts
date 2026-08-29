import type { ZetaDocxEditor } from './engine/zeta-engine';
import { t } from './i18n';
import { resolveAllowedOrigins, decideHostTrust } from './embed-trust';

/**
 * Editor-side of the embed bridge. Lets a host page (which embeds this editor in
 * an <iframe>) drive it and receive events via window.postMessage.
 *
 * SECURITY (cross-origin). The editor only acts on a message that:
 *   (a) comes from its actual embedder — `event.source === window.parent`, and
 *   (b) originates from an allowed origin — either an explicit allowlist (the
 *       `dxeParentOrigin` / `dxeAllowedOrigins` URL params, or the
 *       `allowedOrigins` option) or, when none is configured, the first embedder
 *       origin seen (trust-on-first-use), to which it then LOCKS.
 * Replies — especially `getDocx` document bytes — are posted ONLY to that
 * trusted origin, never to `'*'`. Together this stops other origins/frames from
 * driving the editor or reading the open document.
 *
 * Protocol (see also public/embed-sdk.js — the host-facing wrapper):
 *   Host → Editor:  { source:'dxe-host', v:1, id?, type, payload? }
 *     type: 'load' | 'getDocx' | 'new' | 'setTheme' | 'dispatch' | 'insertText'
 *         | 'mergeFields' | 'print'
 *   Editor → Host:  { source:'dxe', v:1, type, ... }
 *     type: 'ready'                              — editor is up, accepting commands
 *         | 'change'                             — document edited (debounced)
 *         | 'clean'                              — document saved / fresh
 *         | 'save'                               — user pressed Ctrl/Cmd+S (host should save)
 *         | 'result' { id, ok, payload?, error } — reply to a host command
 *
 * Documents cross the boundary as ArrayBuffers (structured-clone / transfer).
 */

const PROTOCOL_VERSION = 1;

/**
 * How a print request was actually served — the payload of a `print` reply.
 *   'dialog'   — the browser's print dialog opened on the rendered PDF
 *   'tab'      — the PDF opened in a new tab; the user prints from there
 *   'download' — neither was possible, so the PDF was downloaded instead
 */
export type PrintOutcome = 'dialog' | 'tab' | 'download';

export interface HostBridgeHooks {
  setStatus?: (s: string) => void;
  setFilename?: (name: string) => void;
  /** Called after a host-driven load / new / export — the document is now "clean". */
  markClean?: () => void;
  /** Print the current document; resolves with how the request was served.
   *  Omit to make the `print` command unavailable to hosts. */
  print?: () => Promise<PrintOutcome>;
}

export interface HostBridgeOptions {
  /**
   * Origins permitted to drive the editor. Merged with the `dxeParentOrigin`
   * (single) and `dxeAllowedOrigins` (comma-separated) URL params. When the
   * resulting set is empty, the editor locks to the first embedder origin it
   * sees (trust-on-first-use) — still gated by `event.source === window.parent`.
   */
  allowedOrigins?: string[];
  /** Allow the host to run raw `.uno:` commands via `dispatch` (default: true). */
  allowDispatch?: boolean;
}

export interface HostBridge {
  /** True when running inside an <iframe> (i.e. actually embedded). */
  isEmbedded: boolean;
  emitChange(): void;
  emitClean(): void;
  emitSaveRequest(): void;
}

export function installHostBridge(
  editor: ZetaDocxEditor,
  root: HTMLElement,
  hooks: HostBridgeHooks = {},
  options: HostBridgeOptions = {},
): HostBridge {
  const search = typeof location !== 'undefined' ? location.search : '';
  const allow = resolveAllowedOrigins(options.allowedOrigins, search);
  // Raw `.uno:` dispatch is on by default; deployers can turn it off with the
  // `allowDispatch:false` option or `?dxeAllowDispatch=0` on the iframe URL.
  let urlDispatch: string | null = null;
  try {
    urlDispatch = new URLSearchParams(search).get('dxeAllowDispatch');
  } catch {
    /* invalid search */
  }
  const allowDispatch = options.allowDispatch !== false && urlDispatch !== '0';
  // The single host origin we trust. Known up front if exactly one origin is
  // allowlisted; otherwise locked to the first accepted embedder message.
  let trustedOrigin: string | null = allow && allow.length === 1 ? allow[0] : null;

  const post = (msg: Record<string, unknown>, transfer: Transferable[] = []) => {
    // Sensitive replies go ONLY to the trusted origin. Before the handshake the
    // only message sent is the non-sensitive 'ready' signal (carries no data).
    window.parent.postMessage(
      { source: 'dxe', v: PROTOCOL_VERSION, ...msg },
      trustedOrigin ?? '*',
      transfer,
    );
  };

  const reply = (
    id: unknown,
    ok: boolean,
    payload?: unknown,
    transfer: Transferable[] = [],
    error?: string,
  ) => {
    if (id == null) return; // fire-and-forget command, no response expected
    post({ type: 'result', id, ok, payload, error }, transfer);
  };

  window.addEventListener('message', async (e: MessageEvent) => {
    const d = e.data;
    if (!d || d.source !== 'dxe-host' || d.v !== PROTOCOL_VERSION) return;

    // Gate on embedder + origin, then lock to that origin for the session.
    const decision = decideHostTrust(
      { allow, trusted: trustedOrigin },
      { isParent: e.source === window.parent, origin: e.origin },
    );
    if (!decision.accept) return;
    trustedOrigin = decision.trusted;

    const { id, type, payload } = d;
    try {
      switch (type) {
        case 'load': {
          const buf = payload.bytes as ArrayBuffer;
          const name = (payload.name as string) || 'document.docx';
          await editor.openDocxBytes(new Uint8Array(buf), name, {
            readOnly: !!payload.readOnly,
          });
          hooks.setFilename?.(name);
          hooks.setStatus?.(`${t('st.loaded')}: ${name}`);
          hooks.markClean?.();
          reply(id, true, { kind: editor.kind });
          break;
        }
        case 'getDocx': {
          // Native bytes: DOCX for a text doc, XLSX for a spreadsheet.
          const bytes = await editor.getBytes();
          const ab = bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer;
          const spec = editor.fileSpec;
          reply(id, true, { bytes: ab, kind: editor.kind, mime: spec.mime, ext: spec.ext }, [ab]);
          hooks.markClean?.(); // host pulled the document → treat as saved
          break;
        }
        case 'new': {
          await editor.newDocument(payload?.kind === 'calc' ? 'calc' : 'writer');
          hooks.setStatus?.(t('st.newdoc'));
          hooks.markClean?.();
          reply(id, true, { kind: editor.kind });
          break;
        }
        case 'setTheme': {
          const vars = (payload?.vars ?? {}) as Record<string, string>;
          for (const [k, v] of Object.entries(vars)) {
            // Restrict to our own theming custom properties — never let a host
            // set arbitrary inline styles on the editor root.
            if (k.startsWith('--dxe-')) root.style.setProperty(k, String(v));
          }
          reply(id, true);
          break;
        }
        case 'dispatch': {
          if (!allowDispatch) {
            reply(id, false, undefined, [], 'dispatch is disabled on this editor');
            break;
          }
          editor.dispatch(payload.uno, payload.args);
          reply(id, true);
          break;
        }
        case 'insertText': {
          editor.insertText(String(payload?.text ?? ''));
          reply(id, true);
          break;
        }
        case 'print': {
          if (!hooks.print) {
            reply(id, false, undefined, [], 'print is not available on this editor');
            break;
          }
          // No click gesture reaches the editor frame from a host command, so
          // WebKit (which can't print an off-screen frame) falls back to
          // downloading the PDF — `method` tells the host what happened.
          reply(id, true, { method: await hooks.print() });
          break;
        }
        case 'mergeFields': {
          const count = await editor.mergeFields(
            (payload?.data ?? {}) as Record<string, string>,
            payload?.options ?? {},
          );
          reply(id, true, { count });
          break;
        }
        default:
          reply(id, false, undefined, [], 'Unknown command: ' + type);
      }
    } catch (err) {
      reply(id, false, undefined, [], (err as Error).message);
    }
  });

  // Announce readiness last, so the listener above is already active.
  post({ type: 'ready' });

  return {
    isEmbedded: window.parent !== window,
    emitChange: () => post({ type: 'change' }),
    emitClean: () => post({ type: 'clean' }),
    emitSaveRequest: () => post({ type: 'save' }),
  };
}
