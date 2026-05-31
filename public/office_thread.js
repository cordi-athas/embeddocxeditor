/* -*- Mode: JS; js-indent-level: 2 -*- */
// SPDX-License-Identifier: MIT
//
// LibreOffice-WASM WORKER THREAD.
//
// Loaded into the LibreOffice WASM worker by zeta.js (2nd entry of
// Module.uno_scripts). Runs inside the worker context where `Module` and
// `zetajs` globals are provided. Plain JS served from public/ — NOT bundled.
//
// Faz 3: hides LibreOffice's own chrome (menubar, toolbars, sidebar, statusbar)
// so OUR toolbar is the only UI, and exposes UNO command dispatch + formatting
// state listeners so our custom buttons can drive and reflect the editor.
// See src/engine/protocol.ts for the message contract.

'use strict';

// zetajs environment (filled once the runtime resolves).
let zetajs, css, context, desktop;
// Current document model + controller.
let xModel, ctrl;
// Last find match (a text range) — for find-next / replace-current.
let lastFound = null;
// Request id of the command currently being handled, echoed on its reply so the
// main thread can correlate replies to requests (set per message in boot()).
let activeRid;

// LibreOffice export filter that writes OOXML .docx (Word 2007+).
const DOCX_FILTER = 'MS Word 2007 XML';

// Boolean toggle commands → mirrored as active/inactive on our buttons.
const STATE_COMMANDS = [
  'Bold', 'Italic', 'Underline', 'Strikeout', 'SubScript', 'SuperScript',
  'LeftPara', 'CenterPara', 'RightPara', 'JustifyPara',
  'DefaultBullet', 'DefaultNumbering',
  'ControlCodes', 'SpellOnline',
];
// Value commands → mirrored as the current value of a dropdown.
const VALUE_COMMANDS = ['CharFontName', 'FontHeight'];

function post(msg) {
  zetajs.mainPort.postMessage(msg);
}

// A reply to the command being handled: tag it with that request's id so the
// main thread can match it (and reject the right pending op on error).
function reply(msg) {
  post({ ...msg, rid: activeRid });
}

// Defense-in-depth for hyperlink insertion: the engine already sanitizes link
// URLs (src/engine/url-safe.ts), but the sink itself refuses dangerous schemes
// (javascript:, data:, file:, …) regardless of caller. Control chars are stripped
// first so `java\tscript:` can't slip past the scheme check.
function isSafeLinkUrl(url) {
  const raw = String(url == null ? '' : url);
  let s = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c > 0x1f && c !== 0x7f) s += raw[i];
  }
  s = s.trim();
  if (!s) return false;
  const m = s.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  return m ? ['http', 'https', 'mailto', 'tel'].includes(m[1].toLowerCase()) : true;
}

function prop(name, value) {
  return new css.beans.PropertyValue({ Name: name, Value: value });
}

// ---- UNO dispatch helpers (from the verified `standalone` example) ----

function transformUrl(unoUrl) {
  const ioparam = { val: new css.util.URL({ Complete: unoUrl }) };
  css.util.URLTransformer.create(context).parseStrict(ioparam);
  return ioparam.val;
}

function queryDispatch(urlObj) {
  return ctrl.queryDispatch(urlObj, '_self', 0);
}

function dispatch(unoUrl, args) {
  const urlObj = transformUrl(unoUrl);
  const disp = queryDispatch(urlObj);
  if (disp) disp.dispatch(urlObj, (args || []).map((a) => prop(a.name, a.value)));
}

// ---- Chrome removal ----

// Hide every Writer toolbar globally (must run before the first doc frame).
function hideAllToolbars() {
  const config = css.configuration.ReadWriteAccess.create(context, 'en-US');
  const states = config.getByHierarchicalName(
    '/org.openoffice.Office.UI.WriterWindowState/UIElements/States',
  );
  for (const name of states.getElementNames()) {
    const el = states.getByName(name);
    if (el.getByName('Visible')) el.setPropertyValue('Visible', false);
  }
  config.commitChanges();
}

// Per-frame chrome: menubar, statusbar, sidebar, rulers.
let chromeHiddenOnce = false;
function hideFrameChrome() {
  const lm = ctrl.getFrame().LayoutManager;
  lm.hideElement('private:resource/menubar/menubar'); // idempotent
  lm.hideElement('private:resource/statusbar/statusbar'); // idempotent
  // `.uno:Sidebar` and `.uno:Ruler` are TOGGLES: calling them on every doc open
  // would flip them back on (the frame is reused across new/open). Hide once.
  if (!chromeHiddenOnce) {
    dispatch('.uno:Sidebar'); // hide the sidebar
    dispatch('.uno:Ruler'); // hide the rulers
    chromeHiddenOnce = true;
  }
}

// Subscribe to formatting state so our toolbar buttons can reflect it.
function listenForState() {
  for (const id of [...STATE_COMMANDS, ...VALUE_COMMANDS]) {
    const urlObj = transformUrl('.uno:' + id);
    const isToggle = STATE_COMMANDS.includes(id);
    const listener = zetajs.unoObject([css.frame.XStatusListener], {
      disposing() {},
      statusChanged(ev) {
        let value = zetajs.fromAny(ev.State);
        if (isToggle) {
          if (typeof value !== 'boolean') value = false; // match desktop UI
        } else if (id === 'FontHeight' && value && typeof value === 'object') {
          value = value.Height; // FontHeight struct → number (points)
        }
        post({ cmd: 'format-state', id, value });
      },
    });
    const disp = queryDispatch(urlObj);
    if (disp) disp.addStatusListener(listener, urlObj);
  }
}

// ---- Document lifecycle ----

function attachAndAnnounce() {
  ctrl = xModel.getCurrentController();
  ctrl.getFrame().getContainerWindow().FullScreen = true;
  lastFound = null; // reset find state for the new document
  hideFrameChrome();
  listenForState();
  listenForChanges();
  reply({ cmd: 'doc_ready' });
}

// Notify the main thread when the document is edited (debounced there → dirty/autosave).
function listenForChanges() {
  const listener = zetajs.unoObject([css.util.XModifyListener], {
    disposing() {},
    modified() {
      // XModifyListener also fires when the modified flag is RESET (e.g. after a
      // save sets it back to false). Only report genuine edits.
      try {
        if (!xModel.isModified()) return;
      } catch (e) {
        /* isModified unavailable → fail open and report */
      }
      post({ cmd: 'modified' });
    },
  });
  xModel.addModifyListener(listener);
}

function newDoc() {
  xModel = desktop.loadComponentFromURL('private:factory/swriter', '_default', 0, []);
  attachAndAnnounce();
}

function openDoc(path, readOnly) {
  const args = readOnly ? [prop('ReadOnly', true)] : [];
  xModel = desktop.loadComponentFromURL('file://' + path, '_default', 0, args);
  attachAndAnnounce();
}

// Resolve the active document regardless of how it was opened.
function getActiveModel() {
  let model = desktop.getCurrentComponent();
  if (!model) {
    const frame = desktop.getCurrentFrame();
    const controller = frame && frame.getController();
    model = controller && controller.getModel();
  }
  if (!model) {
    throw Error('No document to save. Open or create one first.');
  }
  return model;
}

function saveDoc(outPath, filter) {
  const model = getActiveModel();
  const f = filter || DOCX_FILTER;
  model.storeToURL('file://' + outPath, [prop('Overwrite', true), prop('FilterName', f)]);
  // Only a real DOCX save marks the document clean (PDF export must not). The
  // reset event is ignored by the modify listener's isModified() guard.
  if (f === DOCX_FILTER) {
    try {
      model.setModified(false);
    } catch (e) {
      /* XModifiable not available */
    }
  }
  reply({ cmd: 'saved', path: outPath });
}

// ---- Find & Replace (programmatic UNO — no LibreOffice dialog) ----

function configureSearch(desc, data) {
  desc.setSearchString(data.query);
  desc.setPropertyValue('SearchCaseSensitive', !!data.matchCase);
  desc.setPropertyValue('SearchWords', !!data.wholeWord);
}

function doFind(data) {
  try {
    const desc = xModel.createSearchDescriptor();
    configureSearch(desc, data);
    if (data.backwards) desc.setPropertyValue('SearchBackwards', true);

    let found = null;
    if (lastFound) {
      try {
        const start = data.backwards ? lastFound.getStart() : lastFound.getEnd();
        found = xModel.findNext(start, desc);
      } catch (e) {
        found = null; // stale range → fall through to findFirst
      }
    }
    if (!found) found = xModel.findFirst(desc); // first match, or wrap-around
    lastFound = found || null;
    if (found) {
      try {
        ctrl.select(found);
      } catch (e) {
        /* selection may fail on odd ranges */
      }
    }
    reply({ cmd: 'find-result', found: !!found });
  } catch (err) {
    reply({ cmd: 'find-result', found: false });
  }
}

function doReplaceAll(data) {
  try {
    const desc = xModel.createReplaceDescriptor();
    configureSearch(desc, data);
    desc.setReplaceString(data.replacement);
    const count = xModel.replaceAll(desc);
    lastFound = null;
    reply({ cmd: 'replace-result', count: typeof count === 'number' ? count : 0 });
  } catch (err) {
    reply({ cmd: 'replace-result', count: 0 });
  }
}

function doReplaceNext(data) {
  // Replace the current match (if we're on one), then advance to the next.
  if (lastFound) {
    try {
      lastFound.setString(data.replacement);
    } catch (e) {
      /* ignore */
    }
    lastFound = null;
  }
  doFind(data); // posts find-result for the next match
}

// ---- Insert (programmatic UNO — no LibreOffice dialog) ----

function insertTable(rows, cols) {
  const table = xModel.createInstance('com.sun.star.text.TextTable');
  table.initialize(Math.max(1, rows), Math.max(1, cols));
  xModel.getText().insertTextContent(ctrl.getViewCursor(), table, false);
}

function insertImage(path) {
  const provider = context
    .getServiceManager()
    .createInstanceWithContext('com.sun.star.graphic.GraphicProvider', context);
  const graphic = provider.queryGraphic([prop('URL', 'file://' + path)]);
  const img = xModel.createInstance('com.sun.star.text.TextGraphicObject');
  img.setPropertyValue('Graphic', graphic);
  img.setPropertyValue('AnchorType', css.text.TextContentAnchorType.AS_CHARACTER);
  let w = 0;
  let h = 0;
  try {
    const sz = graphic.getPropertyValue('Size100thMM');
    if (sz && sz.Width > 0) {
      w = sz.Width;
      h = sz.Height;
    }
  } catch (e) {
    /* try pixel size next */
  }
  if (!w) {
    try {
      const px = graphic.getPropertyValue('SizePixel');
      if (px && px.Width > 0) {
        // px → 1/100 mm assuming 96 DPI
        w = Math.round((px.Width * 2540) / 96);
        h = Math.round((px.Height * 2540) / 96);
      }
    } catch (e) {
      /* leave default */
    }
  }
  if (w > 0 && h > 0) {
    const maxW = 16000; // ~16 cm — cap so big images fit the page
    if (w > maxW) {
      h = Math.round((h * maxW) / w);
      w = maxW;
    }
    try {
      img.setPropertyValue('Width', w);
      img.setPropertyValue('Height', h);
    } catch (e) {
      /* ignore */
    }
  }
  xModel.getText().insertTextContent(ctrl.getViewCursor(), img, false);
}

function insertLink(url, label) {
  if (!isSafeLinkUrl(url)) return; // engine already blocks this; sink-level backstop
  const text = xModel.getText();
  const vc = ctrl.getViewCursor();
  if (!vc.isCollapsed()) {
    // Apply to the current selection.
    vc.setPropertyValue('HyperLinkURL', url);
    if (label) vc.setPropertyValue('HyperLinkName', label);
    return;
  }
  // No selection: insert the display text, select it, then link it.
  const display = label || url;
  const cur = text.createTextCursorByRange(vc.getStart());
  text.insertString(cur, display, false);
  cur.goLeft(display.length, true);
  cur.setPropertyValue('HyperLinkURL', url);
  cur.setPropertyValue('HyperLinkName', display);
}

function boot() {
  zetajs.mainPort.onmessage = function (e) {
    const data = e.data || {};
    activeRid = data.rid; // correlate this command's reply (incl. any error)
    try {
      switch (data.cmd) {
        case 'new':
          newDoc();
          break;
        case 'open':
          openDoc(data.path, data.readOnly);
          break;
        case 'save':
          saveDoc(data.path, data.filter);
          break;
        case 'dispatch':
          dispatch(data.uno, data.args);
          break;
        case 'find':
          doFind(data);
          break;
        case 'replaceAll':
          doReplaceAll(data);
          break;
        case 'replaceNext':
          doReplaceNext(data);
          break;
        case 'insertTable':
          insertTable(data.rows, data.cols);
          break;
        case 'insertImage':
          insertImage(data.path);
          break;
        case 'insertLink':
          insertLink(data.url, data.text);
          break;
        default:
          throw Error('Unknown command: ' + data.cmd);
      }
    } catch (err) {
      reply({ cmd: 'error', message: String((err && err.message) || err) });
    }
  };

  // Bring up the UNO desktop. If this throws, report it (rid-less → fatal on the
  // main side) so boot fails fast instead of waiting for the boot timeout.
  try {
    context = zetajs.getUnoComponentContext();
    desktop = css.frame.Desktop.create(context);
    hideAllToolbars(); // global; before any document window is created
    post({ cmd: 'thr_running' });
  } catch (err) {
    post({ cmd: 'error', message: 'Editor failed to start: ' + String((err && err.message) || err) });
  }
}

Module.zetajs
  .then(function (pZetajs) {
    zetajs = pZetajs;
    css = zetajs.uno.com.sun.star;
    boot();
  })
  .catch(function (err) {
    // The zetajs runtime itself failed (or boot threw). Best-effort signal; if
    // there is no port yet, the main thread's boot timeout is the backstop.
    try {
      zetajs.mainPort.postMessage({
        cmd: 'error',
        message: 'Editor runtime failed: ' + String((err && err.message) || err),
      });
    } catch (_) {
      /* no port — main thread will time out */
    }
  });
