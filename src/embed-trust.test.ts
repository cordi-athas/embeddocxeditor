// Unit tests for the embed-bridge trust logic.
// Run: npm test   (node --experimental-strip-types --test)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toOrigin, resolveAllowedOrigins, decideHostTrust } from './embed-trust.ts';

const A = 'https://host-a.example';
const B = 'https://host-b.example';

test('toOrigin normalizes and rejects garbage', () => {
  assert.equal(toOrigin('https://host-a.example/some/path?q=1'), A);
  assert.equal(toOrigin('  https://host-a.example  '), A);
  assert.equal(toOrigin('http://localhost:5174'), 'http://localhost:5174');
  assert.equal(toOrigin(''), null);
  assert.equal(toOrigin(null), null);
  assert.equal(toOrigin('not a url'), null);
});

test('resolveAllowedOrigins: none configured → null (trust-on-first-use)', () => {
  assert.equal(resolveAllowedOrigins(undefined, ''), null);
  assert.equal(resolveAllowedOrigins([], '?lang=tr'), null);
});

test('resolveAllowedOrigins: explicit + URL params merge and dedupe', () => {
  assert.deepEqual(resolveAllowedOrigins([A], ''), [A]);
  assert.deepEqual(resolveAllowedOrigins(undefined, `?dxeParentOrigin=${A}`), [A]);
  assert.deepEqual(
    resolveAllowedOrigins(undefined, `?dxeAllowedOrigins=${A},${B}`),
    [A, B],
  );
  // explicit A + url A (dupe) + url B → [A, B]
  assert.deepEqual(resolveAllowedOrigins([A], `?dxeParentOrigin=${A}&dxeAllowedOrigins=${B}`), [
    A,
    B,
  ]);
});

test('decideHostTrust: rejects messages not from the parent frame', () => {
  // Even an allowlisted origin is rejected if it is not window.parent.
  const r = decideHostTrust({ allow: [A], trusted: null }, { isParent: false, origin: A });
  assert.equal(r.accept, false);
  assert.equal(r.trusted, null);
});

test('decideHostTrust: rejects opaque (null) origins', () => {
  const r = decideHostTrust({ allow: null, trusted: null }, { isParent: true, origin: 'null' });
  assert.equal(r.accept, false);
});

test('decideHostTrust: allowlist accepts listed, rejects unlisted', () => {
  assert.equal(
    decideHostTrust({ allow: [A], trusted: A }, { isParent: true, origin: A }).accept,
    true,
  );
  assert.equal(
    decideHostTrust({ allow: [A], trusted: A }, { isParent: true, origin: B }).accept,
    false,
  );
});

test('decideHostTrust: trust-on-first-use locks to the first parent origin', () => {
  // First message (no allowlist, nothing locked) → accept and lock to its origin.
  const first = decideHostTrust({ allow: null, trusted: null }, { isParent: true, origin: A });
  assert.equal(first.accept, true);
  assert.equal(first.trusted, A);

  // A different origin afterwards is rejected (locked to A).
  const intruder = decideHostTrust({ allow: null, trusted: A }, { isParent: true, origin: B });
  assert.equal(intruder.accept, false);
  assert.equal(intruder.trusted, A);

  // Same origin afterwards is still accepted.
  assert.equal(
    decideHostTrust({ allow: null, trusted: A }, { isParent: true, origin: A }).accept,
    true,
  );
});

test('decideHostTrust: pre-locked single allowlist rejects other origins', () => {
  // installHostBridge pre-locks `trusted` when exactly one origin is allowlisted.
  assert.equal(
    decideHostTrust({ allow: [A], trusted: A }, { isParent: true, origin: B }).accept,
    false,
  );
});
