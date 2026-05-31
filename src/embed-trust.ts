// Pure, dependency-free trust logic for the embed bridge (src/embed-host.ts).
// Isolated here (no DOM/engine imports) so it can be unit-tested in Node.
// See src/embed-trust.test.ts.

/** Normalize a value to its origin (`scheme://host:port`), or null if unparseable. */
export function toOrigin(value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  try {
    return new URL(v).origin;
  } catch {
    return null;
  }
}

/**
 * Build the trusted-origin allowlist from explicit origins + the
 * `dxeParentOrigin` (single) / `dxeAllowedOrigins` (comma-separated) URL params.
 * Returns null when nothing is configured (→ trust-on-first-use).
 */
export function resolveAllowedOrigins(explicit?: string[], search = ''): string[] | null {
  const out = new Set<string>();
  for (const o of explicit ?? []) {
    const norm = toOrigin(o);
    if (norm) out.add(norm);
  }
  try {
    const p = new URLSearchParams(search);
    const fromUrl = [p.get('dxeParentOrigin'), ...(p.get('dxeAllowedOrigins') ?? '').split(',')];
    for (const o of fromUrl) {
      const norm = toOrigin(o);
      if (norm) out.add(norm);
    }
  } catch {
    /* invalid search string */
  }
  return out.size ? [...out] : null;
}

/**
 * Pure trust decision for an inbound host message.
 * @param state.allow    configured allowlist (null = trust-on-first-use)
 * @param state.trusted  the origin already locked to this session (or null)
 * @param msg.isParent   whether `event.source === window.parent`
 * @param msg.origin     the message's `event.origin`
 * @returns accept + the (possibly newly-locked) trusted origin
 */
export function decideHostTrust(
  state: { allow: string[] | null; trusted: string | null },
  msg: { isParent: boolean; origin: string },
): { accept: boolean; trusted: string | null } {
  if (!msg.isParent) return { accept: false, trusted: state.trusted };
  const originOk =
    !!msg.origin &&
    msg.origin !== 'null' && // opaque / sandboxed parent
    (state.allow ? state.allow.includes(msg.origin) : true);
  if (!originOk) return { accept: false, trusted: state.trusted };
  if (state.trusted == null) return { accept: true, trusted: msg.origin }; // lock on first
  if (msg.origin !== state.trusted) return { accept: false, trusted: state.trusted };
  return { accept: true, trusted: state.trusted };
}
