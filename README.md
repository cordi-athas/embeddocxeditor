# embeddocxeditor

**Offline-first, tam-sadakatli (full-fidelity) DOCX editörü — tamamen tarayıcıda.**

Çekirdek motor: **LibreOffice'in WebAssembly'e derlenmiş hali** ([ZetaOffice / ZetaJS](https://github.com/allotropia/zetajs)).
Gerçek LibreOffice layout motoru tarayıcıda çalıştığı için sayfalama, tablolar, numaralandırma, üstbilgi/altbilgi, alanlar ve değişiklik takibi **Word'le birebir** render edilir — sunucu yok, dosya yüklemesi yok.

> Durum: **çalışan POC.** Doğrulandı: tarayıcıda boot, DOCX aç/render, DOCX kaydet (round-trip), ve **kendi özel arayüzü** — LibreOffice'in menü/araç çubuğu/sidebar/statusbar'ı gizli, üstteki kendi toolbar'ımız `.uno:*` komutlarını dispatch ediyor ve buton durumlarını yansıtıyor. Sıradaki işler: [docs/ROADMAP.md](docs/ROADMAP.md).

---

## Neden bu mimari?

Kısıtlar: **saf tarayıcı + birebir Word paritesi + offline + lisans esnek (AGPL'siz).**
Bu kombinasyonu karşılayan tek gerçekçi açık kaynak temel ZetaJS'tir. Tam gerekçe ve elenen alternatifler (OnlyOffice-WASM/AGPL, eigenpal/parite-henüz-yok, sıfırdan motor): [docs/DECISION.md](docs/DECISION.md).

## Çalıştırma

```bash
npm install
npm run dev      # http://localhost:5173  (predev: zeta.js'i vendor'lar + WASM'ı pinler/indirir)
```

İlk `dev`/`build` öncesi `npm run fetch:wasm` (predev/prebuild'de otomatik) **sürümü sabitlenmiş** LibreOffice-WASM build'ini (`scripts/wasm-pin.json`, ~52 MB) `public/wasm/<pin>/` altına indirir ve her dosyayı **sha256 ile doğrular**. Dosyalar **same-origin** sunulur (CDN'e runtime bağımlılığı yok); Service Worker bunları cache'ler → **ikinci açılış offline çalışır**. Ayrıntı: aşağıda [WASM sürüm sabitleme](#wasm-sürüm-sabitleme-pin--varsayılan).

Üretim derlemesi:

```bash
npm run build && npm run preview
```

> **Zorunlu:** Sayfa *cross-origin isolated* olmalı (LibreOffice thread'leri `SharedArrayBuffer` ister). Dev/preview header'ları `vite.config.ts` içinde ayarlı. **Üretimde de** her yanıtta şu iki header şart:
> ```
> Cross-Origin-Opener-Policy: same-origin
> Cross-Origin-Embedder-Policy: require-corp
> ```
> Ayrıca `/wasm/` altındaki **`*.wasm` ve `*.data` Brotli** saklanır; host bunları `Content-Encoding: br` ile sunmalı (dev/preview için `vite.config.ts` hallediyor — üretim host'unda da şart, yoksa "expected magic word" hatası). Bkz. [WASM sürüm sabitleme](#wasm-sürüm-sabitleme-pin--varsayılan).

## Kaydetme — ve önemli bir tuzak

Belgeyi gerçek diskine indirmek için **üstteki "Kaydet" (DOCX) / "PDF" butonlarını** kullan.
Belge DOCX/PDF olarak export edilir (`storeToURL`, `MS Word 2007 XML` / `writer_pdf_Export`) ve:
- **Destekleyen tarayıcılarda (Chromium):** native **"Farklı Kaydet"** penceresi açılır — konum + dosya adı + uzantı seçilir (File System Access API, `showSaveFilePicker`).
- **Firefox/Safari veya cross-origin iframe'de:** doğrudan indirme (fallback).

Belge ister "Aç"/"Yeni" ile, ister LibreOffice'in kendi Start Center'ından açılmış olsun, kayıt anında *aktif* belge çözülür.

> ℹ️ **Not (WASM sanal FS tuzağı):** LibreOffice'in **kendi** Kaydet'i `/home/web_user` gibi bir pencere açıp WASM'ın **sanal dosya sistemine** yazar — senin diskine değil. Bu yüzden **Ctrl+S _ve_ Ctrl+Shift+S yakalanıp** (modül yüklenir yüklenmez, capture-phase'de) bizim kaydet/dışa-aktar akışımıza yönlendirilir; LibreOffice'in menü/araç çubuğu da gizli. Yani normalde o pencereye hiç ulaşmazsın — üstteki **File ▸ Kaydet**'i kullan.

## Nasıl çalışıyor? (özet)

```
Ana thread                          LibreOffice-WASM worker (em-pthread)
─────────────                        ──────────────────────────────────
<canvas id=qtcanvas>  ◀── render ──  LibreOffice (Qt5) çizimi
ZetaDocxEditor (TS)   ◀─ MessagePort ▶ public/office_thread.js
  FS.writeFile  ───────── /tmp/office/*.docx (paylaşımlı Emscripten FS) ─────────▶ loadComponentFromURL
  FS.readFile   ◀──────── storeToURL(FilterName: "MS Word 2007 XML") ◀────────────
```

- `src/engine/zeta-engine.ts` — **senin paketinin çekirdeği.** Tüm ZetaJS/UNO/Emscripten detayını gizleyen temiz API: `boot()`, `newDocument()`, `openDocx(File)`, `saveDocx(): Blob`, `dispatch('.uno:Bold')`, `onFormatState(cb)`.
- **Kendi arayüzü (Faz 3):** LibreOffice'in menü/araç çubuğu/sidebar/statusbar'ı worker'da gizlenir; kendi toolbar'ımız (`index.html`'de `data-uno`/`data-state`'li butonlar) `.uno:*` dispatch eder ve buton aktif-durumlarını `XStatusListener` ile yansıtır.
- `public/office_thread.js` — worker; UNO API ile belgeyi açar/oluşturur/dışa aktarır.
- `public/sw.js` — offline app-shell + WASM cache.

Ayrıntı: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Başka siteye gömme (embed)

Tüm editör tek bir kök (`.dxe`) altında ve **stiller bu köke izole** — host sayfanın CSS'iyle çakışmaz. Boot boyunca canvas gizli bir overlay arkasında durur, böylece kullanıcı **LibreOffice'in hiçbir arayüzünü (Start Center, menü, cetvel, sidebar) görmez** — sadece bizim UI.

Cross-origin isolation (COOP/COEP) gerektiği için **en sağlam gömme yolu iframe**:

```html
<iframe
  src="https://senin-hostun/"
  allow="cross-origin-isolated; clipboard-write"
  style="width:100%; height:600px; border:0; border-radius:10px"
></iframe>
```

- **Host sayfa cross-origin isolated olmalı** (kendi sunucusunda `COOP: same-origin` + `COEP: require-corp`). Bunu npm paketi ayarlayamaz; host yapar.
- **Editör** ise embed edilebilmek için `Cross-Origin-Resource-Policy: cross-origin` gönderir (cross-origin iframe COEP altında aksi halde bloklanır) — `vite.config.ts`'te ayarlı, üretimde de gönder.

### React paketi: `@embeddocx/react`

React uygulamaları için hazır bileşen (`packages/react`): `<DocxEditor src=… document=… onChange=… ref=…/>`. Çalışan örnek: `packages/react/example` (`npm i && npm run dev` → editörü iframe'le gömer). Ayrıntı: [packages/react/README.md](packages/react/README.md).

```tsx
import { DocxEditor, type DocxEditorHandle } from '@embeddocx/react';
const ref = useRef<DocxEditorHandle>(null);
<DocxEditor ref={ref} src="https://editor.example.com"
  document={bytes} onChange={() => setDirty(true)} onSave={save} />
// const out = await ref.current!.getDocx();
```

### Host API (SDK)

Host sayfan editörle bağımlılıksız bir SDK üzerinden konuşur (`public/embed-sdk.js`).
Host belgeyi **programatik verir ve geri alır** — dosya diyaloğuna gerek yok:

```js
import { DocxEditorClient } from 'https://SENIN-HOSTUN/embed-sdk.js';

const editor = new DocxEditorClient(document.querySelector('iframe#editor'));
await editor.ready();

await editor.loadDocument(arrayBuffer, { name: 'rapor.docx' }); // belgeyi yükle
editor.on('change', () => markDirty());                          // düzenlendi
const bytes = await editor.getDocx();                            // güncel DOCX (Uint8Array)

editor.newDocument();
editor.setTheme({ '--dxe-accent': '#2563eb' });
editor.dispatch('.uno:Bold');
```

| Metot / olay | İş |
|------|-----|
| `ready()` | Editör hazır olunca çözülür (komutlar öncesi bekle) |
| `loadDocument(bytes, {name, readOnly})` | Host'tan belge yükle |
| `getDocx() → Uint8Array` | Güncel belgeyi DOCX byte'ı olarak al (host kendi "Kaydet"i için) |
| `newDocument()` · `setTheme(vars)` · `dispatch(uno, args)` | yeni belge / tema / ham UNO komutu |
| `on('ready' \| 'change' \| 'clean' \| 'save' \| 'error', cb)` | olaylar |

Editör içinde **Ctrl/Cmd+S** LibreOffice'in iç kaydetmesine gitmez — embed'de host'a **`save`** olayı yollar (host `getDocx` ile kalıcılaştırır), standalone'da indirir. `change`/`clean` ile kaydedilmemiş değişiklik takibi yapılır.

Belgeler sınır boyunca **ArrayBuffer** olarak geçer (base64 yok). Çalışan örnek: **`packages/react/example`** — host'u iframe ile gömüp Yükle/İndir/Tema'yı sürer.

### Güvenlik (cross-origin / postMessage)

Köprü **origin-güvenli** tasarlandı:

- **Editör yalnızca kendi gömücüsünden** (`event.source === window.parent`) ve **izinli bir origin'den** gelen komutu işler. İzin listesi verilmezse gördüğü **ilk** host origin'ine kilitlenir (trust-on-first-use). Cevaplar — özellikle `getDocx` belge byte'ları — **sadece** o güvenilen origin'e gönderilir, asla `'*'`'a.
- **SDK / React client**, mesajları iframe `src`'inden türettiği **editör origin'ine** yollar (`'*'` değil) ve gelen olaylarda `event.origin`'i doğrular — yani otomatik, ek ayar gerekmez.

Açık izin listesi (TOFU yerine) ve sertleştirme için iframe `src`'ine parametre eklenir:

| Parametre | Etki |
|-----------|------|
| `?dxeParentOrigin=https://host.example` | Editörü tek bir host origin'ine kilitle |
| `?dxeAllowedOrigins=https://a.example,https://b.example` | Birden çok origin'e izin ver |
| `?dxeAllowDispatch=0` | Ham `.uno:` `dispatch` komutunu kapat |

Standalone deploy'da `installHostBridge(editor, root, hooks, { allowedOrigins, allowDispatch })` ile de ayarlanabilir. (Karar mantığı `src/embed-trust.ts`'te izole + `npm test` ile birim-test edilir.)

## Tema

`.dxe` üzerindeki CSS değişkenleriyle yeniden renklendirilir:

```css
.dxe {
  --dxe-accent:  #2563eb;   /* vurgu (aktif buton, spinner) */
  --dxe-surface: #ffffff;   /* toolbar zemini */
  --dxe-fg:      #1f2937;   /* metin */
  --dxe-border:  #e6e8eb;
  --dxe-radius:  10px;
}
```

## Dil (i18n)

Arayüz **varsayılan İngilizce**; şu an **EN ve TR** var. Seçim yolları:

- **Kod seviyesinde:** `import { setLang } from './i18n'; setLang('tr');` (init öncesi) veya `src/i18n.ts`'teki `DEFAULT_LANG`.
- **iframe embed:** `src=".../?lang=tr"` (URL parametresi).
- **React:** `<DocxEditor lang="tr" … />` (otomatik `?lang=`'e çevrilir).

Yeni metinler `src/i18n.ts` içindeki sözlüğe eklenir; statik DOM dizeleri `applyI18n()` ile uygulanır, dinamikler `t('key')` ile.

## Lisans notu (önemli)

- Bu repodaki **wrapper kodu (engine, UI, embed bridge, React paketi) MIT** — [`LICENSE`](LICENSE). `@embeddocx/react` da MIT yayınlanır.
- `zetajs` npm paketi **MIT** (allotropia). Redistribute edildiği için lisansı `public/vendor/zetajs/LICENSE`'a kopyalanır (`copy-vendor`).
- LibreOffice-WASM payload'ı (`soffice.*`) **MPL-2.0 / LGPL-3.0+**. **Varsayılan kurulum bu dosyaları sürüm sabitleyip kendi origininden sunar** (pin) — yani onları *yeniden dağıtıyorsun*; dolayısıyla MPL/LGPL şartları senin dağıtımına uygulanır. Bunun için gereken artefaktlar repoda: tam lisans metinleri [`licenses/`](licenses/) (MPL-2.0, LGPL-3.0, GPL-3.0) ve atıf/kaynak/değiştirme bildirimi [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md). Yükümlülüğü en aza indirmek istersen `SOFFICE_BASE_URL`'i CDN `_latest`'e çevirip runtime'da çekebilirsin (ama o zaman sürüm sabit değildir).
- **Not:** `@embeddocx/react` paketi yalnızca React wrapper'ı (MIT) içerir; LibreOffice'i barındırmaz (iframe ile ayrı deploy edilen editörü gömer). LibreOffice/Qt bildirimleri **editör web-app deploy'una** uygulanır, npm paketine değil.
- Lisans seçimleri tamamlanmış olsa da, dağıtımdan önce **hukuki kontrol önerilir.**

## WASM sürüm sabitleme (pin) — varsayılan

`_latest` CDN takma adı zamanla yeniden derlenir (yalnızca ~20 dk cache'lenir); ona runtime'da bağlı kalmak boot'ları **tekrar üretilemez** kılar ve sessizce bozulabilir. Bu yüzden varsayılan olarak **tek bir build sabitlenir** (`scripts/wasm-pin.json`, build tarihi `2025-05-13`) ve same-origin sunulur:

- `npm run fetch:wasm` (predev/prebuild'de otomatik) dosyaları kaynaktan `public/wasm/<pin>/` altına indirir ve **sha256** ile manifest'e karşı doğrular. Eşleşmezse hata verir — doğrulanmamış byte asla servis edilmez. `--verify` ile diskteki dosyalar da yeniden hash'lenir. Dosyalar git-ignore'lu (~52 MB); **manifest + script'i commit'lemek yeterli** (taze clone birebir aynısını üretir).
- `src/engine/config.ts` → `SOFFICE_BASE_URL = '/wasm/<pin>/'` (same-origin). Same-origin olduğu için CORP derdi yok; offline tamamen senin kontrolünde.
- `soffice.wasm` ve `soffice.data` **Brotli** saklanır (CDN'in gönderdiği biçim) ve `Content-Encoding: br` ile sunulmalıdır. Dev/preview'de `vite.config.ts` bunu hallediyor; **üretim host'un da** `/wasm/` altındaki `*.wasm` ve `*.data`'yı `Content-Encoding: br` (+ `*.wasm` için `Content-Type: application/wasm`) ile sunmalı — aksi halde tarayıcı ham brotli'yi wasm sanıp **"expected magic word"** ile patlar.

**Yeniden pin'leme:** `scripts/wasm-pin.json`'daki `pin`'i ve `src/engine/config.ts`'teki `WASM_PIN`'i bump'la, `public/wasm/<eski>`'yi sil, `source`'u (gerekiyorsa) güncelle, `npm run fetch:wasm` çalıştır, ardından yeni `bytes`/`sha256` değerlerini manifest'e yaz.

**Pin'siz alternatif:** `SOFFICE_BASE_URL = 'https://cdn.zetaoffice.net/zetaoffice_latest/'` → kurulum sıfır, ama sürüm sabit değil (CDN runtime bağımlılığı). Tamamen düz (brotli'siz) bir same-origin barındırma istersen `soffice.*` dosyalarını `public/` köküne koyup `SOFFICE_BASE_URL = ''` yapabilirsin.

## Dosya haritası

| Yol | Rol |
|-----|-----|
| `src/engine/zeta-engine.ts` | Editör API'si (paket çekirdeği) |
| `src/engine/protocol.ts` | Ana thread ↔ worker mesaj sözleşmesi |
| `src/engine/config.ts` | WASM pin (`SOFFICE_BASE_URL`, `WASM_PIN`) + asset URL'leri |
| `src/main.ts` | UI kabuğu (toolbar, aç/kaydet, SW kaydı) |
| `public/office_thread.js` | LibreOffice worker (UNO sürücüsü) |
| `public/sw.js` | Offline cache (pinli `/wasm/` ve CDN: cache-first; kabuk: network-first) |
| `vite.config.ts` | COOP/COEP header'ları + `/wasm/` Brotli (`Content-Encoding: br`) servisi |
| `scripts/copy-vendor.mjs` | `zeta.js`'i node_modules'tan public'e kopyalar |
| `scripts/wasm-pin.json` | Sabitlenmiş WASM manifesti (pin, kaynak, dosya boyut + sha256) |
| `scripts/fetch-wasm.mjs` | Pinli WASM'ı indirir + sha256 doğrular (`npm run fetch:wasm`) |
| `public/wasm/<pin>/` | Sabitlenmiş `soffice.*` (git-ignore'lu, fetch ile üretilir) |
