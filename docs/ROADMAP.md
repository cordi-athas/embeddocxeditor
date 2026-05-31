# Yol Haritası

## Faz 0 — De-risk spike (ŞİMDİ) 🎯

Tüm projeyi taahhüt etmeden önce kanıtlanması gereken üç şey. Kabul kriterleri:

- [ ] **Boot & offline:** `npm run dev` → editör açılıyor. İkinci yüklemede ağ kapalıyken (DevTools → Offline) yine açılıyor (SW cache).
- [ ] **Render sadakati:** Tablolar, numaralandırma, üstbilgi/altbilgi ve görsel içeren *karmaşık* bir gerçek DOCX açılıyor ve Word'deki görünümle gözle örtüşüyor.
- [ ] **Round-trip:** Aç → düzenle → "DOCX Kaydet" → yeniden aç. Biçim/içerik kaybı yok; dosya Word'de sorunsuz açılıyor.

Bu üçü geçerse "saf tarayıcı + birebir parite" hedefi doğrulanmış olur.

## Faz 1 — Editör temeli

- [ ] Hata/durum UI'si, yükleme spinner'ı (canvas üstü overlay — `web-office` örneğindeki gibi).
- [ ] Belge kapatma / "değişiklik var mı" takibi (`Modified` durumu UNO'dan).
- [ ] PDF dışa aktarma (`storeToURL`, `writer_pdf_Export`).
- [ ] Klavye/odak ve yüksek-DPI/zoom davranışının cilalanması.

## Faz 2 — "Amaca özel paket" haline getirme

- [x] **Çoklu dil (i18n):** arayüz İngilizce varsayılan; EN/TR. Kod seviyesinde `setLang()` / `DEFAULT_LANG`, ayrıca `?lang=tr` URL parametresi ve React `lang` prop'u ([src/i18n.ts](../src/i18n.ts)). Yeni dil eklemek için sözlüğe bir giriş yeter.

- [x] **Host entegrasyon API'si (embed):** iframe postMessage köprüsü (`src/embed-host.ts`) + bağımlılıksız host SDK (`public/embed-sdk.js`: `ready`/`loadDocument`/`getDocx`/`newDocument`/`setTheme`/`dispatch` + `on('change'|'ready'|'error')`) + çalışan demo host sayfası (`public/embed-demo.html`). Belgeler ArrayBuffer ile geçer; yükleme sonrası `change` susturulur.
- [x] **Ctrl/Cmd+S yakalama + dirty + beforeunload:** Ctrl+S, Qt'den önce (window-capture, boot öncesi kaydedilmiş listener) yakalanır → embed'de host'a `save` olayı, standalone'da indirme. `/home/web_user` tuzağı kapandı. Kaydedilmemiş değişiklik takibi (`change`/`clean` olayları + toolbar'da amber nokta) ve sekme kapatma uyarısı eklendi.
- [ ] **Harici açılışları algıla:** LibreOffice Start Center / drag-drop ile açılan belgeleri UNO frame/component listener ile fark edip toolbar durumunu ve dosya adını güncelle.
- [ ] `ZetaDocxEditor`'ı bağımsız npm paketi olarak ayır (UI'dan tamamen bağımsız çekirdek).
- [x] **React paketi** (`embeddocx-react`): iframe-saran `<DocxEditor>` bileşeni + `DocxEditorClient` + tsup build + çalışan örnek (`packages/react/example`). Cross-origin embed için editöre `Cross-Origin-Resource-Policy: cross-origin` eklendi.
- [ ] Vue sarmalayıcısı (aynı SDK üzerine).
- [ ] Olay API'si: `onReady`, `onChange`, `onSave`, `onError`.
- [ ] Programatik API: içerik enjeksiyonu, find/replace, alan/merge (UNO `XText` üzerinden).

## Faz 3 — Özel arayüz ✅ (temel tamam)

LibreOffice'in kendi Qt UI'sı yerine kendi arayüzün:

- [x] UNO ile menübar/araç çubukları/sidebar/statusbar gizlendi (`public/office_thread.js`).
- [x] Kendi toolbar'ımız `.uno:Bold/Italic/Underline`, hizalama, madde işareti, undo/redo dispatch ediyor.
- [x] `XStatusListener` ile buton aktif/pasif senkronu çalışıyor (boot sonrası boş belge ile Start Center atlanıyor).
- [x] **Zengin toolbar (Faz A):** tutarlı inline **SVG ikon seti** (~28 ikon, bağımlılıksız, `currentColor` → aktifte accent) + paragraf stili/font/punto, renk/vurgu, kalın/italik/altı-üstü çizili, **alt/üst simge, biçim temizle, girinti ±, satır aralığı menüsü, ¶ biçim işaretleri, yazım denetimi, zoom ±, PDF dışa aktarma**. Hepsi `.uno` dispatch / state-sync ile; dialog açan komut yok.
- [x] **Faz B — Bul & Değiştir:** kendi arama çubuğu (Ctrl+F, sonraki/önceki, Aa/sözcük, Değiştir/Tümü) + programatik UNO (`createSearchDescriptor`/`findFirst`/`replaceAll`) — LibreOffice dialog'u açmadan.
- [x] **Uyarlanır toolbar (dar embed):** genişlik azaldıkça gruplar etiketli açılır düğmelere ("Paragraf ▾") katlanır; çok darda ikon-pill + sığmayanlar tek "⋯" menüsünde (etiketli GÖRÜNÜM/EKLE/PARAGRAF bölümleriyle). Tek satır, sabit yükseklik, her genişlikte tüm araçlar erişilebilir (`src/adaptive-toolbar.ts`).
- [x] **Faz C — Insert:** tablo (satır×sütun grid picker), görsel (kendi dosya seçici → GraphicProvider, SizePixel ile boyut), köprü (URL/metin formu → HyperLinkURL) — hepsi kendi mini-UI + programatik UNO, dialog açmadan.
- [ ] React/Vue bileşeni olarak paketle (`<DocxEditor />`).

## Faz 4 — Üretim sertleştirmesi

- [x] WASM'ı sürüm sabitle + same-origin self-host (`public/wasm/<pin>/`, sha256-doğrulamalı `scripts/fetch-wasm.mjs` + `wasm-pin.json`; `*.wasm`/`*.data` Brotli, `Content-Encoding: br`) → offline garantisi + COEP sadeleşmesi + tekrar-üretilebilir build.
- [ ] Bundle/yükleme optimizasyonu (önbellek başlıkları, sıkıştırma, ön-ısıtma).
- [ ] Büyük belge bellek profili; gerekiyorsa memory64/limit testleri.
- [ ] Lisans (MPL/LGPL) uyum kontrolü — dağıtım modeli netleşince.
- [ ] OPFS/IndexedDB ile oturum kurtarma ve otomatik kaydetme.

## Bilinen riskler (takip et)

- **İndirme boyutu (~52 MB):** hedef kitle için kabul edilebilir mi? Değilse → Tauri (masaüstü) kapısı açık.
- **COOP/COEP:** üçüncü taraf siteye gömme senaryosunu zorlaştırır.
- **WASM bellek tavanı:** çok büyük belgeler.
- **Mobil:** büyük WASM + bellek mobilde zorlayıcı olabilir.
