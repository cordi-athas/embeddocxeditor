// Unit tests for the request/timeout/routing logic. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PendingRequests } from './pending.ts';

test('register: resolves on the reply carrying its rid', async () => {
  const p = new PendingRequests();
  const rid = p.nextRid();
  const promise = p.register(rid, 1000, 'op');
  assert.equal(p.handle({ cmd: 'saved', rid, path: '/x' } as never), 'settled');
  const m = await promise;
  assert.equal((m as { cmd: string }).cmd, 'saved');
  assert.equal(p.size, 0);
});

test('register: rejects when its rid carries an error', async () => {
  const p = new PendingRequests();
  const rid = p.nextRid();
  const promise = p.register(rid, 1000, 'op');
  p.handle({ cmd: 'error', rid, message: 'boom' });
  await assert.rejects(promise, /boom/);
});

test('error routes to the CORRECT request, never the oldest (the bug)', async () => {
  const p = new PendingRequests();
  const r1 = p.nextRid(); // e.g. a long-running save
  const r2 = p.nextRid(); // e.g. a find issued while save is pending
  const save = p.register(r1, 1000, 'save');
  const find = p.register(r2, 1000, 'find');

  let saveSettled = false;
  save.then(() => (saveSettled = true)).catch(() => (saveSettled = true));

  // An error for r2 must reject ONLY find — not the oldest (save).
  assert.equal(p.handle({ cmd: 'error', rid: r2, message: 'find failed' }), 'settled');
  await assert.rejects(find, /find failed/);
  assert.equal(saveSettled, false, 'save must still be pending');
  assert.equal(p.size, 1);

  // save then completes normally on its own rid.
  p.handle({ cmd: 'saved', rid: r1, path: '/x' } as never);
  await save;
  assert.equal(saveSettled, true);
});

test('register: times out and rejects, then a late reply is ignored', async () => {
  const p = new PendingRequests();
  const rid = p.nextRid();
  const promise = p.register(rid, 20, 'slow');
  await assert.rejects(promise, /timed out: slow/);
  assert.equal(p.size, 0);
  // Late reply after the timeout must not throw / must be ignored.
  assert.equal(p.handle({ cmd: 'saved', rid, path: '/x' } as never), 'ignored');
});

test('registerMatch: resolves on a spontaneous predicate match (boot)', async () => {
  const p = new PendingRequests();
  const ready = p.registerMatch((m) => m.cmd === 'thr_running', 1000, 'boot');
  assert.equal(p.handle({ cmd: 'thr_running' }), 'settled');
  await ready;
});

test('registerMatch: times out', async () => {
  const p = new PendingRequests();
  const ready = p.registerMatch((m) => m.cmd === 'thr_running', 20, 'boot');
  await assert.rejects(ready, /timed out: boot/);
});

test('rid-less error is FATAL: rejects every pending request', async () => {
  const p = new PendingRequests();
  const a = p.register(p.nextRid(), 1000, 'a');
  const b = p.register(p.nextRid(), 1000, 'b');
  const boot = p.registerMatch((m) => m.cmd === 'thr_running', 1000, 'boot');
  assert.equal(p.handle({ cmd: 'error', message: 'worker crashed' }), 'fatal');
  await assert.rejects(a, /worker crashed/);
  await assert.rejects(b, /worker crashed/);
  await assert.rejects(boot, /worker crashed/);
  assert.equal(p.size, 0);
});

test('error with unknown rid is an orphan (fire-and-forget op), not fatal', async () => {
  const p = new PendingRequests();
  const live = p.register(p.nextRid(), 1000, 'live');
  let settled = false;
  live.then(() => (settled = true)).catch(() => (settled = true));
  // An insert (fire-and-forget) failed: its rid has no waiter.
  assert.equal(p.handle({ cmd: 'error', rid: 9999, message: 'bad image' }), 'orphan-error');
  assert.equal(settled, false, 'unrelated pending request must survive');
  assert.equal(p.size, 1);
});

test('reply with unknown rid is ignored (no throw)', () => {
  const p = new PendingRequests();
  assert.equal(p.handle({ cmd: 'doc_ready', rid: 1234 }), 'ignored');
});
