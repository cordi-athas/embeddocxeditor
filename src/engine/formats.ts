// Document "kind" and the LibreOffice export filters / MIME types / extensions
// per kind. Pure & dependency-free so it can be unit-tested (see formats.test.ts).
//
// LibreOffice auto-detects the format when OPENING a file, so a kind is only
// needed to (a) create a new blank doc of the right module, (b) pick the native
// SAVE filter, and (c) pick the PDF-export filter (which differs per module).

export type DocKind = 'writer' | 'calc';

export interface FormatSpec {
  /** LibreOffice export filter for the native OOXML format. */
  saveFilter: string;
  /** LibreOffice PDF-export filter (differs per module). */
  pdfFilter: string;
  /** MIME type of the native format. */
  mime: string;
  /** Canonical file extension (with leading dot). */
  ext: string;
}

const SPECS: Record<DocKind, FormatSpec> = {
  writer: {
    saveFilter: 'MS Word 2007 XML',
    pdfFilter: 'writer_pdf_Export',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: '.docx',
  },
  calc: {
    saveFilter: 'Calc MS Excel 2007 XML',
    pdfFilter: 'calc_pdf_Export',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ext: '.xlsx',
  },
};

export function specFor(kind: DocKind): FormatSpec {
  return SPECS[kind] ?? SPECS.writer;
}

// Extensions that LibreOffice opens as a spreadsheet (Calc). Anything else is
// treated as a text document (Writer).
const CALC_EXTS = new Set(['xlsx', 'xlsm', 'xlsb', 'xls', 'ods', 'fods', 'csv', 'tsv']);

/** Infer the document kind from a filename's extension. */
export function kindForFilename(name: string | null | undefined): DocKind {
  const m = /\.([a-z0-9]+)\s*$/i.exec(String(name ?? '').trim());
  const ext = m ? m[1].toLowerCase() : '';
  return CALC_EXTS.has(ext) ? 'calc' : 'writer';
}

/** Replace (or add) a filename's extension with the kind's canonical one. */
export function withKindExt(name: string, kind: DocKind): string {
  const base = String(name ?? '').replace(/\.[^./\\]+$/, '') || 'document';
  return base + specFor(kind).ext;
}
