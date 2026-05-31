# Mimari

## Katmanlar

```
┌──────────────────────────────────────────────────────────────────┐
│ Ana thread (UI)                                                    │
│                                                                    │
│  index.html ──▶ src/main.ts (toolbar, aç/kaydet, SW kaydı)         │
│                     │ kullanır                                     │
│                     ▼                                              │
│            ZetaDocxEditor  (src/engine/zeta-engine.ts)             │
│              • boot() · newDocument() · openDocx() · saveDocx()     │
│              • window.FS ile sanal dosya sistemine yazar/okur       │
│              • MessagePort (Module.uno_main) ile worker'a konuşur   │
│                     │                                              │
│  <canvas id=qtcanvas> ◀── LibreOffice doğrudan buraya render eder  │
└─────────────────────┼──────────────────────────────────────────────┘
                      │ postMessage (protocol.ts: MainToWorker/WorkerToMain)
┌─────────────────────▼──────────────────────────────────────────────┐
│ LibreOffice-WASM worker  (em-pthread)                              │
│   zeta.js (vendored)  +  public/office_thread.js                   │
│     • Module.zetajs.then → zetajs, css = ...com.sun.star           │
│     • Desktop.create → loadComponentFromURL / storeToURL (UNO)     │
│     • soffice.wasm / soffice.data (same-origin pin /wasm/<pin>/)   │
└────────────────────────────────────────────────────────────────────┘
```

## Boot sırası

1. `main.ts` Service Worker'ı kaydeder, `editor.boot()` çağırır.
2. `boot()` global `window.Module`'ü kurar (`canvas`, `uno_scripts`, `locateFile`) ve `soffice.js`'i `<script>` ile yükler.
3. `soffice.js` worker(lar)ı başlatır; `zeta.js` ardından `office_thread.js`'i worker içine yükler.
4. Worker'da `Module.zetajs` resolve olur → `office_thread.js` UNO `Desktop`'ı kurar, `thr_running` yollar.
5. Ana thread `Module.uno_main`'den MessagePort alır; `thr_running` görünce boot tamamlanır.

## Bir belgenin açılması

```
Kullanıcı dosya seçer
  main.ts → editor.openDocx(file)
    FS.writeFile('/tmp/office/<ad>.docx', bytes)   // ana thread
    port.postMessage({cmd:'open', path})
      worker: loadComponentFromURL('file:///tmp/office/<ad>.docx')
      worker: postMessage({cmd:'doc_ready'})
  canvas'ta LibreOffice render'ı belirir
```

## Kaydetme (DOCX export)

```
main.ts → editor.saveDocx('<ad>.docx')
  port.postMessage({cmd:'save', path:'/tmp/office/<ad>.docx'})
    worker: xModel.storeToURL('file://...', FilterName='MS Word 2007 XML')
    worker: postMessage({cmd:'saved', path})
  FS.readFile(path) → Blob → indir
```

`storeToURL` + açık filtre tercih edildi (sade `store()` yerine), çünkü yeni
(boş) belgelerin orijinal URL'si yoktur; açık filtre her durumda DOCX garantiler.

## Neden iki thread + paylaşımlı FS?

LibreOffice-WASM ana tarayıcı thread'inde değil, bir `em-pthread` worker'ında
çalışır (UI'yı bloklamamak ve thread'leri kullanmak için). UNO nesneleri o
worker'a aittir. Dosya baytlarını kopyalayıp postMessage'la yollamak yerine,
Emscripten'in paylaşımlı sanal dosya sistemine (`FS`) yazıp worker'a sadece
*yolu* bildiririz — büyük belgelerde kopya maliyetini düşürür.

## Genişletme noktaları

- **Komutlar:** `protocol.ts`'e yeni `MainToWorker` komutu ekle (ör. `exportPdf`,
  `setZoom`, `toggleTrackChanges`), `office_thread.js`'te UNO dispatch'i ile karşıla.
  PDF için: `storeToURL(..., FilterName='writer_pdf_Export')`.
- **Özel UI (Faz 3 — uygulandı):** `office_thread.js` chrome'u gizler
  (`hideAllToolbars` global toolbar config + `hideFrameChrome` menübar/statusbar/sidebar),
  `.uno:*` komutlarını çalıştırır (`dispatch`) ve `XStatusListener` ile durum yayar
  (`listenForState` → `format-state` mesajı). **Yeni komut eklemek:** `index.html`'e
  `data-uno=".uno:Foo"` (ve durum senkronu için `data-state="Foo"`) butonu ekle;
  durum senkronu istiyorsan `Foo`'yu `office_thread.js`'teki `STATE_COMMANDS`'a da ekle.
- **Kalıcılık:** açık belgeyi OPFS/IndexedDB'ye yazıp oturumlar arası kurtarma.
