import { describe, expect, it } from "vitest";
import { RateLimiter, Semaphore } from "../src/util/infra.js";

const tick = () => new Promise<void>((r) => setImmediate(r));

describe("Semaphore", () => {
  it("never lets more than the maximum run at once, and loses no one", async () => {
    const sem = new Semaphore(3);
    let running = 0;
    let peak = 0;
    let done = 0;
    await Promise.all(
      Array.from({ length: 20 }, async () => {
        await sem.acquire();
        running++;
        peak = Math.max(peak, running);
        await tick();
        running--;
        done++;
        sem.release();
      }),
    );
    expect(peak).toBe(3);
    expect(done).toBe(20);
    expect(sem.inUse).toBe(0);
  });

  it("makes a waiter wait until a slot is released", async () => {
    const sem = new Semaphore(1);
    await sem.acquire();
    let got = false;
    void sem.acquire().then(() => (got = true));
    await tick();
    expect(got).toBe(false);
    sem.release();
    await tick();
    expect(got).toBe(true);
    expect(sem.inUse).toBe(1);
  });
});

describe("RateLimiter", () => {
  it("allows the limit per key per window, then refuses until the window ends", () => {
    let now = 1_000;
    const rl = new RateLimiter(2, 60_000, () => now);
    expect([rl.take("a"), rl.take("a"), rl.take("a")]).toEqual([true, true, false]);
    expect(rl.take("b")).toBe(true);
    now += 59_999;
    expect(rl.take("a")).toBe(false);
    now += 1;
    expect(rl.take("a")).toBe(true);
  });
});
