// Hyperlink URL sanitizer. A link inserted into a document is a stored value
// that some downstream viewer may later treat as a clickable URL — so a
// `javascript:`, `data:`, `vbscript:` or `file:` link is a stored-XSS / unwanted
// navigation vector. We allow only safe schemes (and scheme-less relative URLs).
//
// Pure / dependency-free so it can be unit-tested — see src/engine/url-safe.test.ts.

const ALLOWED_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);
const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

/**
 * Remove ASCII control characters (0x00–0x1F and DEL 0x7F). Browsers ignore
 * TAB/LF/CR inside URLs, so leaving them in would let `java\tscript:` slip past
 * the scheme check. Done with a code-point filter to avoid control-byte literals.
 */
function stripControlChars(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0x1f && c !== 0x7f) out += s[i];
  }
  return out;
}

/**
 * Return a cleaned, safe hyperlink URL, or `null` if it is empty or uses a
 * disallowed scheme.
 */
export function safeLinkUrl(raw: string | null | undefined): string | null {
  const url = stripControlChars(String(raw ?? '')).trim();
  if (!url) return null;
  // RFC 3986 scheme: ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ) ":"
  const m = url.match(SCHEME);
  if (!m) return url; // no scheme → relative / anchor / scheme-relative — safe
  return ALLOWED_SCHEMES.has(m[1].toLowerCase()) ? url : null;
}
