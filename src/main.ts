import './styles.css';
import { ZetaDocxEditor } from './engine/zeta-engine';
import type { FindOpts } from './engine/zeta-engine';
import { safeLinkUrl } from './engine/url-safe';
import { withKindExt } from './engine/formats';
import { installHostBridge, type HostBridge } from './embed-host';
import { installAdaptiveToolbar } from './adaptive-toolbar';
import { setLang, applyI18n, resolveInitialLang, t } from './i18n';
import type { DispatchArg } from './engine/protocol';

type UnoControl = HTMLButtonElement | HTMLSelectElement | HTMLInputElement;

const root = document.getElementById('dxe') as HTMLDivElement;
const canvas = document.getElementById('qtcanvas') as HTMLCanvasElement;
const statusEl = document.getElementById('status') as HTMLSpanElement;
const loadingText = document.getElementById('loadingText') as HTMLDivElement;
const reloadBtn = document.getElementById('reloadBtn') as HTMLButtonElement | null;
const btnNew = document.getElementById('btnNew') as HTMLButtonElement;
const btnNewSheet = document.getElementById('btnNewSheet') as HTMLButtonElement;
const btnOpen = document.getElementById('btnOpen') as HTMLButtonElement;
const btnSave = document.getElementById('btnSave') as HTMLButtonElement;
const btnPdf = document.getElementById('btnPdf') as HTMLButtonElement;
const btnFind = document.getElementById('btnFind') as HTMLButtonElement;
const btnFile = document.getElementById('btnFile') as HTMLButtonElement;
const fileMenu = document.getElementById('fileMenu') as HTMLDivElement;

// Find & Replace bar elements.
const findBar = document.getElementById('findBar') as HTMLDivElement;
const findInput = document.getElementById('findInput') as HTMLInputElement;
const replaceInput = document.getElementById('replaceInput') as HTMLInputElement;
const findCount = document.getElementById('findCount') as HTMLSpanElement;
const matchCaseEl = document.getElementById('matchCase') as HTMLInputElement;
const wholeWordEl = document.getElementById('wholeWord') as HTMLInputElement;

// Insert (table / image / link) elements.
const btnTable = document.getElementById('btnTable') as HTMLButtonElement;
const btnImage = document.getElementById('btnImage') as HTMLButtonElement;
const btnLink = document.getElementById('btnLink') as HTMLButtonElement;
const tablePop = document.getElementById('tablePop') as HTMLDivElement;
const tableGrid = document.getElementById('tableGrid') as HTMLDivElement;
const tableGridLabel = document.getElementById('tableGridLabel') as HTMLDivElement;
const linkPop = document.getElementById('linkPop') as HTMLDivElement;
const linkUrl = document.getElementById('linkUrl') as HTMLInputElement;
const linkText = document.getElementById('linkText') as HTMLInputElement;
const imageFile = document.getElementById('imageFile') as HTMLInputElement;

// Every control that drives a UNO command carries it in [data-uno]; those with
// [data-state] also reflect that command's active value.
const unoControls = Array.from(document.querySelectorAll<UnoControl>('[data-uno]'));
// Action menus: a <select> whose chosen <option> carries its own [data-uno].
const menuControls = Array.from(document.querySelectorAll<HTMLSelectElement>('select[data-menu]'));
const stateControls = new Map<string, UnoControl>();
for (const el of unoControls) {
  if (el.dataset.state) stateControls.set(el.dataset.state, el);
}

const setStatus = (s: string) => {
  statusEl.textContent = s;
};

/**
 * Replace the boot spinner with a terminal error state (canvas stays hidden, the
 * spinner stops) and offer a reload — instead of an infinite spinner when boot
 * fails (network error, missing cross-origin isolation, worker crash, timeout).
 */
function showFatalError(message: string): void {
  root.classList.remove('loading');
  root.classList.add('error');
  loadingText.textContent = message;
  if (reloadBtn) {
    reloadBtn.textContent = t('st.reload');
    reloadBtn.hidden = false;
  }
  setStatus(t('st.error'));
}
/**
 * Drop the cached WASM runtime (same-origin /wasm/ + CDN) from the Service Worker
 * cache, so a corrupt/partial cached payload can't fail the boot again on retry.
 */
async function purgeWasmCache(): Promise<void> {
  if (!('caches' in window)) return;
  for (const name of await caches.keys()) {
    const cache = await caches.open(name);
    for (const req of await cache.keys()) {
      if (req.url.includes('/wasm/') || req.url.includes('cdn.zetaoffice.net')) {
        await cache.delete(req);
      }
    }
  }
}
// The error-state reload self-heals: clear the (suspect) cached runtime, then retry.
if (reloadBtn) {
  reloadBtn.onclick = () => {
    purgeWasmCache()
      .catch(() => {})
      .finally(() => location.reload());
  };
}

const editor = new ZetaDocxEditor({ canvas, onStatus: setStatus });

let booted = false;
let busy = false;
let hasDoc = false;
let dirty = false;
let currentFilename = 'untitled.docx';
let bridge: HostBridge | null = null;

// ── Ctrl/Cmd+S interception ──────────────────────────────────────────────
// Capture-phase, registered at module load (BEFORE the Qt canvas attaches its
// own key handlers during boot) so we beat LibreOffice to Ctrl+S and the user
// never hits its internal save dialog (the /home/web_user virtual-FS trap).
let onSaveShortcut: () => void = () => {};
window.addEventListener(
  'keydown',
  (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      onSaveShortcut();
    } else if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      openFind();
    }
  },
  { capture: true },
);

// ── Find & Replace (our own bar; programmatic UNO under the hood) ──────────
function findOptions(): FindOpts {
  return { matchCase: matchCaseEl.checked, wholeWord: wholeWordEl.checked };
}
function openFind(): void {
  if (!hasDoc) return;
  findBar.hidden = false;
  findInput.focus();
  findInput.select();
}
function closeFind(): void {
  findBar.hidden = true;
}
async function runFind(backwards: boolean): Promise<void> {
  const q = findInput.value;
  if (!q) {
    findCount.textContent = '';
    return;
  }
  try {
    const found = await editor.find(q, { ...findOptions(), backwards });
    findCount.textContent = found ? '' : t('find.notfound');
  } catch {
    findCount.textContent = t('st.error');
  }
}
async function runReplaceOne(): Promise<void> {
  const q = findInput.value;
  if (!q) return;
  const found = await editor.replaceNext(q, replaceInput.value, findOptions());
  findCount.textContent = found ? '' : t('find.done');
}
async function runReplaceAll(): Promise<void> {
  const q = findInput.value;
  if (!q) return;
  const n = await editor.replaceAll(q, replaceInput.value, findOptions());
  findCount.textContent = `${n} ${t('find.replaced')}`;
}
function wireFind(): void {
  btnFind.addEventListener('click', () => (findBar.hidden ? openFind() : closeFind()));
  document.getElementById('findNext')!.addEventListener('click', () => void runFind(false));
  document.getElementById('findPrev')!.addEventListener('click', () => void runFind(true));
  document.getElementById('findClose')!.addEventListener('click', closeFind);
  document.getElementById('replaceOne')!.addEventListener('click', () => void runReplaceOne());
  document.getElementById('replaceAllBtn')!.addEventListener('click', () => void runReplaceAll());
  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void runFind(e.shiftKey);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeFind();
    }
  });
  replaceInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void runReplaceOne();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeFind();
    }
  });
}

// ── Insert: table / image / link (our own mini-UIs, no LibreOffice dialog) ──
const GRID_COLS = 10;
const GRID_ROWS = 8;
let gridBuilt = false;

function anchorPopover(pop: HTMLElement, btn: HTMLElement): void {
  const r = btn.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 260))}px`;
  pop.style.top = `${r.bottom + 4}px`;
}
function closePops(): void {
  tablePop.hidden = true;
  linkPop.hidden = true;
}
function highlightGrid(rows: number, cols: number): void {
  const cells = tableGrid.children;
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i] as HTMLElement;
    const cr = Number(cell.dataset.r) + 1;
    const cc = Number(cell.dataset.c) + 1;
    cell.classList.toggle('on', cr <= rows && cc <= cols);
  }
  tableGridLabel.textContent = rows && cols ? `${cols} × ${rows}` : 'Tablo ekle';
}
function buildTableGrid(): void {
  if (gridBuilt) return;
  gridBuilt = true;
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'dxe-grid-cell';
      cell.dataset.r = String(r);
      cell.dataset.c = String(c);
      cell.addEventListener('mouseenter', () => highlightGrid(r + 1, c + 1));
      cell.addEventListener('click', () => {
        editor.insertTable(r + 1, c + 1);
        closePops();
      });
      tableGrid.appendChild(cell);
    }
  }
}
function openTablePop(): void {
  if (!hasDoc) return;
  closePops();
  buildTableGrid();
  highlightGrid(0, 0);
  tablePop.hidden = false;
  anchorPopover(tablePop, btnTable);
}
function openLinkPop(): void {
  if (!hasDoc) return;
  closePops();
  linkUrl.value = '';
  linkText.value = '';
  linkPop.hidden = false;
  anchorPopover(linkPop, btnLink);
  linkUrl.focus();
}
function wireInsert(): void {
  btnTable.addEventListener('click', (e) => {
    e.stopPropagation();
    if (tablePop.hidden) openTablePop();
    else closePops();
  });
  btnLink.addEventListener('click', (e) => {
    e.stopPropagation();
    if (linkPop.hidden) openLinkPop();
    else closePops();
  });
  btnImage.addEventListener('click', () => {
    if (hasDoc) imageFile.click();
  });
  imageFile.addEventListener('change', async () => {
    const f = imageFile.files?.[0];
    imageFile.value = '';
    if (!f) return;
    setStatus(t('st.imageins'));
    try {
      await editor.insertImage(f);
      setStatus('');
    } catch {
      setStatus(t('st.imagefail'));
    }
  });
  const linkApply = document.getElementById('linkApply')!;
  linkApply.addEventListener('click', () => {
    const raw = linkUrl.value.trim();
    if (!raw) {
      closePops();
      return;
    }
    const safe = safeLinkUrl(raw);
    if (!safe) {
      // Reject javascript:/data:/etc. with feedback; keep the popover open to fix.
      setStatus(t('link.badurl'));
      linkUrl.focus();
      return;
    }
    editor.insertLink(safe, linkText.value.trim() || undefined);
    closePops();
  });
  document.getElementById('linkCancel')!.addEventListener('click', closePops);
  linkUrl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') (linkApply as HTMLButtonElement).click();
    else if (e.key === 'Escape') closePops();
  });

  // Close popovers on outside press or Escape. Using 'mousedown' (not 'click')
  // means the opening click — whose mousedown lands while the popover is still
  // hidden — never closes it.
  document.addEventListener('mousedown', (e) => {
    const t = e.target as Node;
    if (!tablePop.hidden && !tablePop.contains(t) && !btnTable.contains(t)) closePops();
    if (!linkPop.hidden && !linkPop.contains(t) && !btnLink.contains(t)) closePops();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePops();
  });
}

function setDirty(value: boolean): void {
  if (dirty === value) return;
  dirty = value;
  root.classList.toggle('is-dirty', dirty);
  if (dirty) bridge?.emitChange();
  else bridge?.emitClean();
}

function refreshToolbar(): void {
  const fileBusy = !booted || busy;
  btnFile.disabled = fileBusy;
  btnNew.disabled = fileBusy;
  btnNewSheet.disabled = fileBusy;
  btnOpen.disabled = fileBusy;
  btnSave.disabled = fileBusy || !hasDoc;
  btnPdf.disabled = fileBusy || !hasDoc;
  btnFind.disabled = fileBusy || !hasDoc;
  btnTable.disabled = fileBusy || !hasDoc;
  btnImage.disabled = fileBusy || !hasDoc;
  btnLink.disabled = fileBusy || !hasDoc;
  for (const el of unoControls) el.disabled = fileBusy || !hasDoc;
  for (const el of menuControls) el.disabled = fileBusy || !hasDoc;
}

/** Wrap an async toolbar action: disable the toolbar while it runs, then restore. */
function action(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    if (busy) return;
    busy = true;
    refreshToolbar();
    try {
      await fn();
    } catch (e) {
      console.error(e);
      setStatus(`${t('st.error')}: ${(e as Error).message}`);
    } finally {
      busy = false;
      refreshToolbar();
    }
  };
}

/** Build dispatch args from a control's data-* attributes and current value. */
function argsFor(el: UnoControl): DispatchArg[] {
  const arg = el.dataset.arg;
  if (!arg) return []; // plain toggle/command button
  let value: string | number = (el as HTMLInputElement | HTMLSelectElement).value;
  if (el.dataset.type === 'number') value = Number(value);
  if (el.hasAttribute('data-color')) value = parseInt(String(value).slice(1), 16); // #rrggbb → int
  const args: DispatchArg[] = [{ name: arg, value }];
  if (el.dataset.family) args.push({ name: 'FamilyName', value: el.dataset.family });
  return args;
}

function wireControls(): void {
  for (const el of unoControls) {
    const run = () => {
      if (!el.disabled) editor.dispatch(el.dataset.uno!, argsFor(el));
    };
    if (el instanceof HTMLButtonElement) {
      el.addEventListener('mousedown', (e) => e.preventDefault()); // keep selection
      el.addEventListener('click', run);
    } else {
      el.addEventListener('change', run);
    }
  }

  // Action menus (e.g. line spacing): dispatch the chosen option's command, then reset.
  for (const sel of menuControls) {
    sel.addEventListener('change', () => {
      const uno = sel.selectedOptions[0]?.dataset.uno;
      if (uno && !sel.disabled) editor.dispatch(uno);
      sel.selectedIndex = 0; // back to the label option
    });
  }

  editor.onFormatState((id, value) => {
    const el = stateControls.get(id);
    if (!el) return;
    if (el instanceof HTMLSelectElement) {
      const v = String(value);
      if (v && Array.from(el.options).some((o) => o.value === v)) el.value = v;
    } else {
      el.classList.toggle('active', value === true);
    }
  });
}

/** Standalone save: real "Save As" dialog where supported, else a download. */
async function saveAction(): Promise<void> {
  // Save in the document's native format: DOCX (Writer) or XLSX (Calc).
  const spec = editor.fileSpec;
  const name = withKindExt(currentFilename, editor.kind);
  const ok = await exportToFile(
    () => editor.saveFile(),
    name,
    spec.mime,
    spec.ext,
    editor.kind === 'calc' ? t('save.xlsxType') : t('save.docxType'),
    t('st.saving'),
  );
  if (!ok) {
    setStatus('');
    return; // user cancelled the save dialog
  }
  currentFilename = name;
  setStatus(`${t('st.saved')}: ${currentFilename}`);
  setDirty(false);
}

/** The File menu trigger opens a dropdown holding New / Open / Save / PDF. */
function wireFileMenu(): void {
  const close = () => {
    fileMenu.hidden = true;
  };
  btnFile.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = fileMenu.hidden;
    close();
    if (willOpen) {
      fileMenu.hidden = false;
      const r = btnFile.getBoundingClientRect();
      fileMenu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - fileMenu.offsetWidth - 8))}px`;
      fileMenu.style.top = `${r.bottom + 4}px`;
    }
  });
  // Clicking an item closes the menu (the item's own handler still runs).
  fileMenu.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.dxe-mi')) close();
  });
  document.addEventListener('mousedown', (e) => {
    const node = e.target as Node;
    if (!fileMenu.hidden && !fileMenu.contains(node) && !btnFile.contains(node)) close();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  window.addEventListener('resize', close);
}

async function main(): Promise<void> {
  // Language (English by default; ?lang=tr or setLang('tr') to switch).
  setLang(resolveInitialLang());
  applyI18n();

  // LibreOffice threads need SharedArrayBuffer, which the browser only exposes to
  // *cross-origin isolated* pages (COOP/COEP). The most common deployment mistake
  // is missing those headers — fail fast with an actionable message rather than a
  // cryptic Emscripten abort or an endless spinner.
  if (!self.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
    showFatalError(t('st.needsIsolation'));
    return;
  }

  // Offline-first: cache the app shell + the ~52 MB WASM payload after first load.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('/sw.js')
      .catch((e) => console.warn('Service Worker registration failed:', e));
  }

  wireControls();
  wireFind();
  wireInsert();
  wireFileMenu();
  installAdaptiveToolbar(document.querySelector('.dxe-toolbar') as HTMLElement, root);

  // Overlay stays up (canvas hidden) through startup — user never sees LibreOffice.
  loadingText.textContent = t('st.loading');
  await editor.boot();
  booted = true;
  refreshToolbar();

  // Create the first (blank) document while still behind the overlay.
  loadingText.textContent = t('st.preparing');
  await editor.newDocument();
  hasDoc = true;
  currentFilename = 'untitled.docx';
  refreshToolbar();

  // Reveal the clean editor.
  root.classList.remove('loading');
  setStatus('');

  // Expose the embed API to a host page (no-op when opened directly).
  bridge = installHostBridge(editor, root, {
    setStatus,
    setFilename: (name) => {
      currentFilename = name;
    },
    markClean: () => setDirty(false),
  });

  // Edits → dirty (debounced in the engine, then mirrored to the host).
  editor.onChange(() => setDirty(true));

  // Ctrl/Cmd+S: embedded → ask the host to save; standalone → download.
  onSaveShortcut = () => {
    if (!booted || busy) return;
    if (bridge?.isEmbedded) bridge.emitSaveRequest();
    else void action(saveAction)();
  };

  // Warn before leaving with unsaved changes (mainly standalone).
  window.addEventListener('beforeunload', (e) => {
    if (dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  btnNew.onclick = action(async () => {
    setStatus('');
    await editor.newDocument('writer');
    hasDoc = true;
    currentFilename = 'untitled.docx';
    setDirty(false);
    setStatus(t('st.newblank'));
  });

  btnNewSheet.onclick = action(async () => {
    setStatus('');
    await editor.newDocument('calc');
    hasDoc = true;
    currentFilename = 'untitled.xlsx';
    setDirty(false);
    setStatus(t('st.newblank'));
  });

  btnOpen.onclick = async () => {
    if (!booted || busy) return;
    // Pick OUTSIDE the busy lock — the toolbar must stay responsive while the
    // file dialog is open (and if the user cancels).
    const file = await pickFile();
    if (!file) return;
    await action(async () => {
      setStatus(`${t('st.opening')}: ${file.name}`);
      currentFilename = file.name; // keep the original name+ext; save normalizes by kind
      await editor.openDocx(file);
      hasDoc = true;
      setDirty(false);
      setStatus(`${t('st.opened')}: ${file.name}`);
    })();
  };

  btnSave.onclick = action(saveAction);

  btnPdf.onclick = action(async () => {
    const name = currentFilename.replace(/\.[^./\\]+$/, '') + '.pdf';
    const ok = await exportToFile(
      () => editor.exportPdf(name),
      name,
      'application/pdf',
      '.pdf',
      t('save.pdfType'),
      t('st.pdfgen'),
    );
    if (!ok) {
      setStatus('');
      return;
    }
    setStatus(`${t('st.pdfdone')}: ${name}`);
  });
}

function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.docx,.doc,.odt,.rtf,.xlsx,.xls,.ods,.csv';
    let settled = false;
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', onFocus);
      resolve(file);
    };
    // The dialog fires no 'change' when cancelled, so also listen for 'cancel'
    // (modern browsers) and use a focus fallback — otherwise the caller hangs.
    const onFocus = () => setTimeout(() => finish(input.files?.[0] ?? null), 300);
    input.addEventListener('change', () => finish(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => finish(null));
    window.addEventListener('focus', onFocus);
    input.click();
  });
}

/**
 * Save a generated Blob. Where supported (Chromium), opens a native "Save As"
 * dialog (choose folder + file name + extension) via the File System Access
 * API; otherwise falls back to a normal download. The picker opens first — while
 * the click gesture is still active — then the content is produced and written.
 * Returns false if the user cancelled the dialog.
 */
async function exportToFile(
  produce: () => Promise<Blob>,
  suggestedName: string,
  mime: string,
  ext: string,
  description: string,
  workingMessage: string,
): Promise<boolean> {
  const showPicker = (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let handle: any = null;
  if (typeof showPicker === 'function') {
    try {
      handle = await (showPicker as (opts: unknown) => Promise<unknown>)({
        suggestedName,
        types: [{ description, accept: { [mime]: [ext] } }],
      });
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return false; // user cancelled
      handle = null; // unsupported context (e.g. cross-origin iframe) → fall back
    }
  }
  setStatus(workingMessage);
  const blob = await produce();
  if (handle) {
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
  } else {
    downloadBlob(blob, suggestedName);
  }
  return true;
}

function downloadBlob(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

main().catch((e) => {
  console.error(e);
  showFatalError(`${t('st.failed')}: ${(e as Error).message}`);
});
