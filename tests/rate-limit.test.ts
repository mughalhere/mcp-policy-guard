import { describe, expect, it } from "vitest";
import { RateLimiter } from "../src/rate-limit/token-bucket.js";

describe("RateLimiter scopes", () => {
  it("does not burn global budget when a narrower bucket rejects", () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxCalls: 10, perTool: true });
    const tight = new RateLimiter({
      windowMs: 60_000,
      maxCalls: 10,
      overrides: [{ patterns: ["expensive_*"], maxCalls: 1 }],
    });

    expect(tight.check("expensive_report").ok).toBe(true);
    const blocked = tight.check("expensive_report");
    expect(blocked.ok).toBe(false);

    // Global still has budget for other tools, because the rejected call
    // never consumed a global token.
    for (let i = 0; i < 9; i++) expect(tight.check("cheap_tool").ok).toBe(true);
    expect(limiter.check("anything").ok).toBe(true);
  });

  it("reports which scope rejected", () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxCalls: 1, perTool: true });
    expect(limiter.check("a").ok).toBe(true);
    const result = limiter.check("b");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.scope).toBe("global");
      expect(result.limit).toBe(1);
      expect(result.retryAfterMs).toBeGreaterThan(0);
    }
  });

  it("applies per-pattern overrides ahead of the per-tool bucket", () => {
    const limiter = new RateLimiter({
      windowMs: 60_000,
      maxCalls: 100,
      overrides: [{ patterns: ["send_email"], maxCalls: 2 }],
    });
    expect(limiter.check("send_email").ok).toBe(true);
    expect(limiter.check("send_email").ok).toBe(true);
    const third = limiter.check("send_email");
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.scope).toBe("override");
    expect(limiter.check("search").ok).toBe(true);
  });

  it("isolates identities when perIdentity is on", () => {
    const limiter = new RateLimiter({
      windowMs: 60_000,
      maxCalls: 4,
      perTool: false,
      perIdentity: true,
    });
    expect(limiter.check("t", "alice").ok).toBe(true);
    expect(limiter.check("t", "alice").ok).toBe(true);
    expect(limiter.check("t", "bob").ok).toBe(true);
    // alice: 2 used, bob: 1 used, global: 3 used
    expect(limiter.check("t", "bob").ok).toBe(true);
    const exhausted = limiter.check("t", "carol");
    expect(exhausted.ok).toBe(false);
    if (!exhausted.ok) expect(exhausted.scope).toBe("global");
  });

  it("evicts least-recently-used buckets past maxBuckets", () => {
    const limiter = new RateLimiter({
      windowMs: 60_000,
      maxCalls: 1_000,
      perTool: true,
      maxBuckets: 10,
    });
    for (let i = 0; i < 500; i++) limiter.check(`tool_${i}`);
    expect(limiter.size).toBeLessThanOrEqual(10);
  });

  it("rejects nonsensical configuration at construction", () => {
    expect(() => new RateLimiter({ windowMs: 1_000, maxCalls: 0 })).toThrow(RangeError);
    expect(() => new RateLimiter({ windowMs: 0, maxCalls: 1 })).toThrow(RangeError);
  });

  it("refills over time", async () => {
    const limiter = new RateLimiter({ windowMs: 40, maxCalls: 1, perTool: false });
    expect(limiter.check("t").ok).toBe(true);
    expect(limiter.check("t").ok).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(limiter.check("t").ok).toBe(true);
  });
});
