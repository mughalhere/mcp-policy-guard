import { describe, expect, it } from "vitest";
import { RateLimiter, TokenBucket } from "../src/rate-limit/token-bucket.js";

describe("TokenBucket", () => {
  it("allows up to capacity then denies", () => {
    const bucket = new TokenBucket({ capacity: 2, refillPerMs: 0 });
    expect(bucket.take().ok).toBe(true);
    expect(bucket.take().ok).toBe(true);
    const denied = bucket.take();
    expect(denied.ok).toBe(false);
  });
});

describe("RateLimiter", () => {
  it("enforces per-tool limits", () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxCalls: 1, perTool: true });
    expect(limiter.check("a").ok).toBe(true);
    expect(limiter.check("a").ok).toBe(false);
    // global also consumed — second tool may still fail on global
  });
});
