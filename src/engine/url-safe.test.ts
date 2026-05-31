// Unit tests for the hyperlink URL sanitizer. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeLinkUrl } from './url-safe.ts';

const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);
const NUL = String.fromCharCode(0);

test('allows safe schemes and scheme-less URLs', () => {
  assert.equal(safeLinkUrl('https://example.com/p?q=1#f'), 'https://example.com/p?q=1#f');
  assert.equal(safeLinkUrl('http://example.com'), 'http://example.com');
  assert.equal(safeLinkUrl('mailto:a@b.com'), 'mailto:a@b.com');
  assert.equal(safeLinkUrl('tel:+15551234'), 'tel:+15551234');
  assert.equal(safeLinkUrl('/docs/page'), '/docs/page'); // relative
  assert.equal(safeLinkUrl('#section'), '#section'); // anchor
  assert.equal(safeLinkUrl('//cdn.example.com/x'), '//cdn.example.com/x'); // scheme-relative
  assert.equal(safeLinkUrl('  https://example.com  '), 'https://example.com'); // trimmed
});

test('rejects dangerous schemes', () => {
  assert.equal(safeLinkUrl('javascript:alert(1)'), null);
  assert.equal(safeLinkUrl('JavaScript:alert(1)'), null); // case-insensitive
  assert.equal(safeLinkUrl('  javascript:alert(1)'), null); // leading space
  assert.equal(safeLinkUrl('data:text/html,<script>x</script>'), null);
  assert.equal(safeLinkUrl('vbscript:msgbox(1)'), null);
  assert.equal(safeLinkUrl('file:///etc/passwd'), null);
});

test('rejects control-character evasions (java\\tscript:)', () => {
  assert.equal(safeLinkUrl('java' + TAB + 'script:alert(1)'), null);
  assert.equal(safeLinkUrl('java' + LF + 'script:alert(1)'), null);
  assert.equal(safeLinkUrl('javascript' + NUL + ':alert(1)'), null);
});

test('empty / whitespace / nullish → null', () => {
  assert.equal(safeLinkUrl(''), null);
  assert.equal(safeLinkUrl('   '), null);
  assert.equal(safeLinkUrl(null), null);
  assert.equal(safeLinkUrl(undefined), null);
  assert.equal(safeLinkUrl(TAB + TAB), null);
});
