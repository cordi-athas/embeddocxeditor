# Mimari Karar Kaydı (ADR-001): Çekirdek motor olarak LibreOffice-WASM (ZetaJS)

**Tarih:** 2026-05-30 · **Durum:** Kabul edildi

## Bağlam / kısıtlar

Tam-kapasiteli bir DOCX editörü hedefleniyor. Doğrulanmış gereksinimler:

| Kısıt | Değer |
|------|-------|
| Platform | **Saf tarayıcı** (web) |
| Sadakat | **Birebir Word paritesi — ilk günden şart** |
| Çalışma | **Offline-first** |
| Lisans | Esnek kalmalı, AGPL alınamaz → **wrapper kodu MIT'e karar verildi** (gömülü LibreOffice MPL-2.0/LGPL-3.0+ kalır; bkz. THIRD-PARTY-NOTICES.md) |
| Yaklaşım | Açık kaynaktan ilerleyip **amaca özel yeni paket** çıkarmak |

Anahtar gözlem: DOCX'i parse/yazmak kolaydır; **Word'le birebir render etmek** (sayfalama, satır kırma, tablo autofit, numaralandırma motoru, font metrikleri, alanlar/TOC, dipnotlar, değişiklik takibi, OMML) işin %80'idir ve yüzlerce kişi-yılı emek demektir.

## Değerlendirilen seçenekler

1. **Sıfırdan custom motor** (ProseMirror/Lexical + OOXML eşlemesi)
   → Birebir parite için gerçekçi değil. *Elendi.*

2. **eigenpal/docx-editor** (Apache-2.0, TS/ProseMirror, kendi layout motoru)
   → Lisansı ideal, "kendi paketin" için en uygun, ama parite **bugün hazır değil** (tablo/görsel olgun değil). "İlk günden birebir parite" kısıtını karşılamıyor. *Şimdilik elendi; ileride hibrit UI katmanı için aday.*

3. **OnlyOffice-WASM** (CryptPad `onlyoffice-x2t-wasm` + sdkjs; ör. ZIZIYI Office)
   → Gerçek tam parite + cilalı editör + offline. Ama **AGPL-3.0**. Lisans belirsizken (ileride kapalı ticari olabilir) kilitlenme riski. *Elendi.*

4. **ZetaOffice / ZetaJS** (LibreOffice → WASM; MPL-2.0/LGPL, wrapper MIT) ✅
   → Gerçek LibreOffice layout motoru = birebir parite. Saf tarayıcı, cache sonrası offline. **AGPL değil** → ticari kapı açık. npm paketi + doğrulanmış embed modeli mevcut.

## Karar

**ZetaJS (LibreOffice-WASM)** çekirdek motor olarak seçildi; etrafına `ZetaDocxEditor` adında ince, framework-agnostik bir wrapper paketi inşa edilecek ("amaca özel yeni paket" hedefi bu wrapper'da somutlaşıyor).

## Sonuçlar

**Artılar:** Gün bir birebir parite; olgun, bakımlı motor; offline; ticari-dostu lisans yolu.

**Eksiler / kabul edilen bedeller:**
- İlk yükleme ağır: **~52 MB** (`soffice.wasm` 36 MB + `soffice.data` 16 MB). Service Worker cache ile hafifletilir.
- **Cross-origin isolation (COOP/COEP)** zorunlu → hosting ve "başka siteye gömme" senaryosunu etkiler.
- Varsayılan UI LibreOffice'in kendi Qt arayüzüdür. Tamamen özel UI istiyorsak UNO API üzerinden kendi chrome'umuzu kurmamız gerekir (bkz. ROADMAP).
- Büyük belgelerde WASM bellek tavanı bir risk.

## Doğrulanmış teknik gerçekler (2026-05)

- `zetajs` npm **v1.2.0**, lisans **MIT**, içerik `source/zeta.js` + `source/zetaHelper.js`.
- WASM kaynağı: ZetaOffice CDN `https://cdn.zetaoffice.net/zetaoffice_latest/` — `soffice.js` (0.86 MB), `soffice.wasm` (36.3 MB br), `soffice.data` (15.9 MB br) doğrulandı (HTTP 200). `_latest` rolling alias olduğu için **versiyonlu CDN yolu yok** (yalnızca `<sürüm>/desktop/` installer'ları versiyonlu; WASM değil). Bu yüzden sabit build (2025-05-13) `public/wasm/<pin>/` altına self-host edilip sha256 ile pinlendi (`scripts/wasm-pin.json`). `*.wasm`/`*.data` Brotli'dir → `Content-Encoding: br` ile sunulur.
- Boot modeli: `Module.uno_scripts = [zeta.js, office_thread.js]`, `Module.canvas = #qtcanvas`, `Module.uno_main` → MessagePort; worker'da `Module.zetajs.then(...)`.
- Dosya değişimi: paylaşımlı Emscripten `FS` (`/tmp/office/...`); export filtresi `MS Word 2007 XML`.
- Zorunlu header'lar: `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`.

## Geri dönüş tetikleyicileri (bu kararı gözden geçir)

- ~52 MB indirme hedef kullanıcı için kabul edilemezse → **masaüstü (Tauri)** ya da OnlyOffice-WASM yeniden değerlendirilir.
- Lisans "açık kaynak/şirket içi" olarak netleşirse → daha iyi editör UX'i için OnlyOffice-WASM tekrar masaya gelebilir.
- COOP/COEP, "üçüncü taraf siteye embed" senaryosunu bloklarsa → iframe/popup mimarisi değerlendirilir.
