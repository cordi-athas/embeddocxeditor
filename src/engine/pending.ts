// Correlates worker replies to the requests that are awaiting them, with a
// per-request timeout so a crashed/silent worker can never hang a promise
// forever. Pure (no DOM / MessagePort) so it can be unit-tested — see
// src/engine/pending.test.ts.
//
// Two ways to wait:
//   • register(rid)      — await the reply carrying this request id (rid)
//   • registerMatch(fn)  — await a *spontaneous* message matching a predicate
//                          (used once, for boot readiness `thr_running`)
//
// Routing of an incoming message (handle):
//   • has rid, waiter found → resolve (or reject if it's an `error`)
//   • has rid, no waiter    → 'orphan-error' (a fire-and-forget op failed) or 'ignored'
//   • no rid, `error`       → 'fatal': reject EVERY pending request (boot/runtime crash)
//   • no rid, predicate hit → resolve that waiter

/** Minimal shape of a worker→main message this module needs to route. */
export interface Reply {
  cmd: string;
  rid?: number;
  message?: string;
}

type Entry = {
  rid?: number;
  match?: (m: Reply) => boolean;
  resolve: (m: Reply) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  label: string;
};

export type HandleOutcome = 'settled' | 'fatal' | 'orphan-error' | 'ignored';

export class PendingRequests {
  private seq = 0;
  private readonly entries: Entry[] = [];

  /** Allocate a unique request id. */
  nextRid(): number {
    return ++this.seq;
  }

  /** Await the reply correlated to `rid`; rejects on worker error or timeout. */
  register(rid: number, timeoutMs: number, label: string): Promise<Reply> {
    return new Promise<Reply>((resolve, reject) => {
      const timer = setTimeout(() => this.expire(timer, label, timeoutMs, reject), timeoutMs);
      this.entries.push({ rid, resolve, reject, timer, label });
    });
  }

  /** Await a spontaneous message matching `match`; rejects on timeout. */
  registerMatch(match: (m: Reply) => boolean, timeoutMs: number, label: string): Promise<Reply> {
    return new Promise<Reply>((resolve, reject) => {
      const timer = setTimeout(() => this.expire(timer, label, timeoutMs, reject), timeoutMs);
      this.entries.push({ match, resolve, reject, timer, label });
    });
  }

  /** Route an incoming worker message to the right waiter(s). */
  handle(m: Reply): HandleOutcome {
    if (m.rid != null) {
      const e = this.take((w) => w.rid === m.rid);
      if (!e) return m.cmd === 'error' ? 'orphan-error' : 'ignored';
      if (m.cmd === 'error') e.reject(new Error(m.message || 'Operation failed'));
      else e.resolve(m);
      return 'settled';
    }
    if (m.cmd === 'error') {
      // Uncorrelated error = boot/runtime failure: nothing can complete.
      this.rejectAll(new Error(m.message || 'Editor error'));
      return 'fatal';
    }
    const e = this.take((w) => !!w.match && w.match(m));
    if (e) {
      e.resolve(m);
      return 'settled';
    }
    return 'ignored';
  }

  /** Reject and clear every pending request (e.g. on fatal error or teardown). */
  rejectAll(err: Error): void {
    for (const e of this.entries.splice(0)) {
      clearTimeout(e.timer);
      e.reject(err);
    }
  }

  /** Number of outstanding requests (for tests/diagnostics). */
  get size(): number {
    return this.entries.length;
  }

  private expire(
    timer: ReturnType<typeof setTimeout>,
    label: string,
    timeoutMs: number,
    reject: (e: Error) => void,
  ): void {
    const i = this.entries.findIndex((e) => e.timer === timer);
    if (i < 0) return; // already settled
    this.entries.splice(i, 1);
    reject(new Error(`Editor timed out: ${label} (${Math.round(timeoutMs / 1000)}s)`));
  }

  private take(pred: (e: Entry) => boolean): Entry | undefined {
    const i = this.entries.findIndex(pred);
    if (i < 0) return undefined;
    const [e] = this.entries.splice(i, 1);
    clearTimeout(e.timer);
    return e;
  }
}
