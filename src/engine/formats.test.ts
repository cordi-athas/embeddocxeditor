// Unit tests for the format/kind mapping. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { specFor, kindForFilename, withKindExt } from './formats.ts';

test('kindForFilename: spreadsheet extensions → calc, rest → writer', () => {
  for (const n of ['report.xlsx', 'a.XLS', 'data.ods', 'x.csv', 'y.tsv', 'sheet.xlsm']) {
    assert.equal(kindForFilename(n), 'calc', n);
  }
  for (const n of ['report.docx', 'a.DOC', 'notes.odt', 'r.rtf', 'plain.txt', 'noext', '']) {
    assert.equal(kindForFilename(n), 'writer', n);
  }
  assert.equal(kindForFilename(null), 'writer');
});

test('specFor: native save filter, pdf filter, mime, ext per kind', () => {
  const w = specFor('writer');
  assert.equal(w.saveFilter, 'MS Word 2007 XML');
  assert.equal(w.pdfFilter, 'writer_pdf_Export');
  assert.equal(w.ext, '.docx');
  assert.match(w.mime, /wordprocessingml/);

  const c = specFor('calc');
  assert.equal(c.saveFilter, 'Calc MS Excel 2007 XML');
  assert.equal(c.pdfFilter, 'calc_pdf_Export');
  assert.equal(c.ext, '.xlsx');
  assert.match(c.mime, /spreadsheetml/);
});

test('withKindExt: swaps/adds the kind extension', () => {
  assert.equal(withKindExt('report.xlsx', 'writer'), 'report.docx');
  assert.equal(withKindExt('report.docx', 'calc'), 'report.xlsx');
  assert.equal(withKindExt('noext', 'calc'), 'noext.xlsx');
  assert.equal(withKindExt('', 'writer'), 'document.docx');
});
