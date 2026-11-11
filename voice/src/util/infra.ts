/**
 * Small concurrency helpers: a counting semaphore and a per-key rate limiter.
 *
 * Origin: phone_map `server/util/infra.ts`. Changed here: `Bus` is not carried over (it was
 * typed to the IVR mapper's live events), and the rate limiter takes its clock as an argument
 * so it can be tested without waiting.
 */

export class Semaphore {
  private waiters: (() => void)[] = [];
  private active = 0;
  constructor(private max: number) {}
  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    await new Promise<void>((r) => this.waiters.push(r));
  }
  /** Hands the slot straight to the next waiter, so `inUse` never exceeds the maximum. */
  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.active--;
  }
  get inUse(): number {
    return this.active;
  }
}

/** Fixed-window per-key rate limiter. */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  constructor(
    private limit: number,
    private windowMs: number,
    private clock: () => number = Date.now,
  ) {}
  /** True when the key may proceed; false when it has used its allowance for this window. */
  take(key: string): boolean {
    const now = this.clock();
    const h = this.hits.get(key);
    if (!h || h.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      if (this.hits.size > 10000) for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
      return true;
    }
    if (h.count >= this.limit) return false;
    h.count++;
    return true;
  }
}
