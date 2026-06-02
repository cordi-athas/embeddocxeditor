// Tiny i18n layer. English is the default; Turkish is available.
//
// Code-level language selection:
//   import { setLang } from './i18n';  setLang('tr');   // before init
// Or change DEFAULT_LANG below. A `?lang=en|tr` URL param and the document's
// <html lang> are also honoured (handy for iframe embeds: src=".../?lang=tr").

export type Lang = 'en' | 'tr';

/** Code-level default language. */
export const DEFAULT_LANG: Lang = 'en';

const MESSAGES: Record<Lang, Record<string, string>> = {
  en: {
    't.new': 'New document', 't.newsheet': 'New spreadsheet', 't.open': 'Open file', 't.save': 'Save', 't.pdf': 'Export as PDF',
    't.numfmt': 'Number format', 't.cells': 'Cells',
    't.undo': 'Undo', 't.redo': 'Redo', 't.bold': 'Bold', 't.italic': 'Italic', 't.underline': 'Underline',
    't.strike': 'Strikethrough', 't.subscript': 'Subscript', 't.superscript': 'Superscript',
    't.fontcolor': 'Font color', 't.highlight': 'Highlight color', 't.clear': 'Clear formatting',
    't.alignleft': 'Align left', 't.aligncenter': 'Center', 't.alignright': 'Align right', 't.justify': 'Justify',
    't.bullet': 'Bulleted list', 't.numbered': 'Numbered list', 't.indentdec': 'Decrease indent', 't.indentinc': 'Increase indent',
    't.linespacing': 'Line spacing', 't.marks': 'Formatting marks', 't.spell': 'Spell check',
    't.zoomout': 'Zoom out', 't.zoomin': 'Zoom in', 't.table': 'Insert table', 't.image': 'Insert image',
    't.link': 'Insert link', 't.find': 'Find & replace (Ctrl+F)',
    'group.file': 'File', 'group.style': 'Style', 'group.format': 'Format', 'group.paragraph': 'Paragraph', 'group.insert': 'Insert', 'group.view': 'View', 'group.more': 'More',
    'aria.parastyle': 'Paragraph style', 'aria.font': 'Font', 'aria.size': 'Size', 'aria.linespacing': 'Line spacing', 'aria.toolbar': 'Formatting',
    'opt.normal': 'Normal', 'opt.title': 'Title', 'opt.subtitle': 'Subtitle', 'opt.h1': 'Heading 1', 'opt.h2': 'Heading 2', 'opt.h3': 'Heading 3', 'opt.quote': 'Quotation',
    'ls.single': 'Single (1.0)', 'ls.onehalf': '1.5', 'ls.double': 'Double (2.0)',
    'find.find': 'Find', 'find.replace': 'Replace', 'find.replaceBtn': 'Replace', 'find.replaceAll': 'All',
    'find.matchcase': 'Aa', 'find.wholeword': 'Word', 'find.prev': 'Previous (Shift+Enter)', 'find.next': 'Next (Enter)', 'find.close': 'Close (Esc)',
    'find.notfound': 'not found', 'find.replaced': 'replaced', 'find.done': 'done',
    'link.urlph': 'https://...', 'link.textph': 'Display text (optional)', 'link.add': 'Add', 'link.cancel': 'Cancel',
    'link.badurl': 'Only http(s), mailto, and tel links are allowed.',
    'st.loading': 'Loading editor…', 'st.preparing': 'Preparing document…', 'st.failed': 'Failed to load',
    'st.newblank': 'New blank document.', 'st.opening': 'Opening', 'st.opened': 'Opened',
    'st.saving': 'Saving as DOCX…', 'st.saved': 'Saved', 'st.pdfgen': 'Generating PDF…', 'st.pdfdone': 'PDF downloaded',
    'st.imageins': 'Inserting image…', 'st.imagefail': 'Couldn’t insert image',
    'st.loaded': 'Loaded', 'st.newdoc': 'New document', 'st.error': 'Error',
    'st.reload': 'Reload',
    'st.needsIsolation':
      'This editor must run on a cross-origin isolated page. Add the COOP/COEP response headers (see README).',
    'save.docxType': 'Word document', 'save.xlsxType': 'Excel workbook', 'save.pdfType': 'PDF document',
  },
  tr: {
    't.new': 'Yeni belge', 't.newsheet': 'Yeni elektronik tablo', 't.open': 'Dosya aç', 't.save': 'Kaydet', 't.pdf': 'PDF olarak dışa aktar',
    't.numfmt': 'Sayı biçimi', 't.cells': 'Hücreler',
    't.undo': 'Geri al', 't.redo': 'Yinele', 't.bold': 'Kalın', 't.italic': 'İtalik', 't.underline': 'Altı çizili',
    't.strike': 'Üstü çizili', 't.subscript': 'Alt simge', 't.superscript': 'Üst simge',
    't.fontcolor': 'Yazı rengi', 't.highlight': 'Vurgu rengi', 't.clear': 'Biçimi temizle',
    't.alignleft': 'Sola hizala', 't.aligncenter': 'Ortala', 't.alignright': 'Sağa hizala', 't.justify': 'İki yana yasla',
    't.bullet': 'Madde işareti', 't.numbered': 'Numaralı liste', 't.indentdec': 'Girintiyi azalt', 't.indentinc': 'Girintiyi artır',
    't.linespacing': 'Satır aralığı', 't.marks': 'Biçim işaretleri', 't.spell': 'Yazım denetimi',
    't.zoomout': 'Uzaklaştır', 't.zoomin': 'Yakınlaştır', 't.table': 'Tablo ekle', 't.image': 'Görsel ekle',
    't.link': 'Köprü ekle', 't.find': 'Bul ve Değiştir (Ctrl+F)',
    'group.file': 'Dosya', 'group.style': 'Stil', 'group.format': 'Biçim', 'group.paragraph': 'Paragraf', 'group.insert': 'Ekle', 'group.view': 'Görünüm', 'group.more': 'Diğer',
    'aria.parastyle': 'Paragraf stili', 'aria.font': 'Yazı tipi', 'aria.size': 'Punto', 'aria.linespacing': 'Satır aralığı', 'aria.toolbar': 'Biçimlendirme',
    'opt.normal': 'Normal', 'opt.title': 'Başlık', 'opt.subtitle': 'Alt başlık', 'opt.h1': 'Başlık 1', 'opt.h2': 'Başlık 2', 'opt.h3': 'Başlık 3', 'opt.quote': 'Alıntı',
    'ls.single': 'Tek (1.0)', 'ls.onehalf': '1.5', 'ls.double': 'Çift (2.0)',
    'find.find': 'Bul', 'find.replace': 'Değiştir', 'find.replaceBtn': 'Değiştir', 'find.replaceAll': 'Tümü',
    'find.matchcase': 'Aa', 'find.wholeword': 'Söz', 'find.prev': 'Önceki (Shift+Enter)', 'find.next': 'Sonraki (Enter)', 'find.close': 'Kapat (Esc)',
    'find.notfound': 'bulunamadı', 'find.replaced': 'değişti', 'find.done': 'bitti',
    'link.urlph': 'https://...', 'link.textph': 'Görünen metin (opsiyonel)', 'link.add': 'Ekle', 'link.cancel': 'İptal',
    'link.badurl': 'Yalnızca http(s), mailto ve tel bağlantılarına izin verilir.',
    'st.loading': 'Düzenleyici yükleniyor…', 'st.preparing': 'Belge hazırlanıyor…', 'st.failed': 'Yüklenemedi',
    'st.newblank': 'Yeni boş belge.', 'st.opening': 'Açılıyor', 'st.opened': 'Açıldı',
    'st.saving': 'DOCX olarak kaydediliyor…', 'st.saved': 'Kaydedildi', 'st.pdfgen': 'PDF oluşturuluyor…', 'st.pdfdone': 'PDF indirildi',
    'st.imageins': 'Görsel ekleniyor…', 'st.imagefail': 'Görsel eklenemedi',
    'st.loaded': 'Yüklendi', 'st.newdoc': 'Yeni belge', 'st.error': 'Hata',
    'st.reload': 'Yeniden yükle',
    'st.needsIsolation':
      "Bu düzenleyici cross-origin isolated bir sayfada çalışmalı. COOP/COEP yanıt header'larını ekleyin (README'ye bakın).",
    'save.docxType': 'Word belgesi', 'save.xlsxType': 'Excel çalışma kitabı', 'save.pdfType': 'PDF belgesi',
  },
};

let current: Lang = DEFAULT_LANG;

export function setLang(lang: Lang): void {
  if (lang === 'en' || lang === 'tr') current = lang;
}
export function getLang(): Lang {
  return current;
}
export function t(key: string): string {
  return MESSAGES[current][key] ?? MESSAGES.en[key] ?? key;
}

/** Resolve initial language: ?lang= → <html lang> → DEFAULT_LANG. */
export function resolveInitialLang(): Lang {
  try {
    const q = new URLSearchParams(window.location.search).get('lang');
    if (q === 'en' || q === 'tr') return q;
  } catch {
    /* ignore */
  }
  const htmlLang = document.documentElement.lang?.slice(0, 2).toLowerCase();
  if (htmlLang === 'tr' || htmlLang === 'en') return htmlLang;
  return DEFAULT_LANG;
}

const setText = (id: string, key: string) => {
  const e = document.getElementById(id);
  if (e) e.textContent = t(key);
};
const setTitle = (id: string, key: string) => {
  const e = document.getElementById(id);
  if (e) e.title = t(key);
};
const setPlaceholder = (id: string, key: string) => {
  const e = document.getElementById(id) as HTMLInputElement | null;
  if (e) e.placeholder = t(key);
};
const setAria = (sel: string, key: string) => {
  const e = document.querySelector<HTMLElement>(sel);
  if (e) {
    e.title = t(key);
    e.setAttribute('aria-label', t(key));
  }
};

/** Apply the current language to all static UI strings in the DOM. */
export function applyI18n(): void {
  document.documentElement.lang = current;

  const byId: Record<string, string> = {
    btnNew: 't.new', btnNewSheet: 't.newsheet', btnOpen: 't.open', btnSave: 't.save', btnPdf: 't.pdf', btnFind: 't.find',
    calcNumFmt: 't.numfmt', calcCells: 't.cells',
    btnTable: 't.table', btnImage: 't.image', btnLink: 't.link',
  };
  for (const [id, key] of Object.entries(byId)) setTitle(id, key);

  // File menu: trigger label + item labels.
  setText('lblFile', 'group.file');
  setTitle('btnFile', 'group.file');
  setText('miNew', 't.new');
  setText('miNewSheet', 't.newsheet');
  setText('miOpen', 't.open');
  setText('miSave', 't.save');
  setText('miPdf', 't.pdf');

  const byUno: Record<string, string> = {
    '.uno:Undo': 't.undo', '.uno:Redo': 't.redo', '.uno:Bold': 't.bold', '.uno:Italic': 't.italic',
    '.uno:Underline': 't.underline', '.uno:Strikeout': 't.strike', '.uno:SubScript': 't.subscript',
    '.uno:SuperScript': 't.superscript', '.uno:ResetAttributes': 't.clear',
    '.uno:LeftPara': 't.alignleft', '.uno:CenterPara': 't.aligncenter', '.uno:RightPara': 't.alignright',
    '.uno:JustifyPara': 't.justify', '.uno:DefaultBullet': 't.bullet', '.uno:DefaultNumbering': 't.numbered',
    '.uno:DecrementIndent': 't.indentdec', '.uno:IncrementIndent': 't.indentinc',
    '.uno:ControlCodes': 't.marks', '.uno:SpellOnline': 't.spell', '.uno:ZoomMinus': 't.zoomout', '.uno:ZoomPlus': 't.zoomin',
    '.uno:FontColor': 't.fontcolor', '.uno:CharBackColor': 't.highlight',
  };
  document.querySelectorAll<HTMLElement>('[data-uno]').forEach((el) => {
    const key = byUno[el.dataset.uno ?? ''];
    if (!key) return;
    el.title = t(key);
    const colorLabel = el.closest('.color') as HTMLElement | null;
    if (colorLabel) colorLabel.title = t(key);
  });

  setAria('[data-uno=".uno:StyleApply"]', 'aria.parastyle');
  setAria('[data-uno=".uno:CharFontName"]', 'aria.font');
  setAria('[data-uno=".uno:FontHeight"]', 'aria.size');
  setAria('select[data-menu]', 'aria.linespacing');
  document.querySelector('.dxe-toolbar')?.setAttribute('aria-label', t('aria.toolbar'));

  const styleOpts: Record<string, string> = {
    'Default Paragraph Style': 'opt.normal', Title: 'opt.title', Subtitle: 'opt.subtitle',
    'Heading 1': 'opt.h1', 'Heading 2': 'opt.h2', 'Heading 3': 'opt.h3', Quotations: 'opt.quote',
  };
  document.querySelectorAll<HTMLOptionElement>('[data-uno=".uno:StyleApply"] option').forEach((o) => {
    const key = styleOpts[o.value];
    if (key) o.textContent = t(key);
  });
  const lsOpts: Record<string, string> = {
    '.uno:SpacePara1': 'ls.single', '.uno:SpacePara15': 'ls.onehalf', '.uno:SpacePara2': 'ls.double',
  };
  document.querySelectorAll<HTMLOptionElement>('select[data-menu] option[data-uno]').forEach((o) => {
    const key = lsOpts[o.dataset.uno ?? ''];
    if (key) o.textContent = t(key);
  });

  setPlaceholder('findInput', 'find.find');
  setPlaceholder('replaceInput', 'find.replace');
  setText('replaceOne', 'find.replaceBtn');
  setText('replaceAllBtn', 'find.replaceAll');
  setText('lblMatchCase', 'find.matchcase');
  setText('lblWholeWord', 'find.wholeword');
  setTitle('findPrev', 'find.prev');
  setTitle('findNext', 'find.next');
  setTitle('findClose', 'find.close');

  setPlaceholder('linkUrl', 'link.urlph');
  setPlaceholder('linkText', 'link.textph');
  setText('linkApply', 'link.add');
  setText('linkCancel', 'link.cancel');
}
