import { matchAnyGlob } from "../policy/glob.js";

export type TokenBucketOptions = {
  capacity: number;
  refillPerMs: number;
};

export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillPerMs: number;

  constructor(options: TokenBucketOptions) {
    this.capacity = options.capacity;
    this.refillPerMs = options.refillPerMs;
    this.tokens = options.capacity;
    this.lastRefill = Date.now();
  }

  /** Refill, then consume one token if available. */
  take(): { ok: true } | { ok: false; retryAfterMs: number } {
    if (!this.canTake()) return { ok: false, retryAfterMs: this.retryAfterMs() };
    this.tokens -= 1;
    return { ok: true };
  }

  /** Refill and report whether a token is available, without consuming it. */
  canTake(): boolean {
    this.refill();
    return this.tokens >= 1;
  }

  /** Consume a token unconditionally. Pair with {@link canTake}. */
  consume(): void {
    this.tokens -= 1;
  }

  /** Milliseconds until the next token becomes available. Always >= 1. */
  retryAfterMs(): number {
    if (this.refillPerMs <= 0) return Number.POSITIVE_INFINITY;
    return Math.max(Math.ceil((1 - this.tokens) / this.refillPerMs), 1);
  }

  /** Tokens currently available, for diagnostics. */
  get available(): number {
    this.refill();
    return this.tokens;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    this.lastRefill = now;
  }
}

/** Which bucket rejected a call. */
export type RateLimitScope = "global" | "tool" | "identity" | "override";

export type RateLimitOverride = {
  /** Tool-name globs this override applies to. */
  patterns: string[];
  /** Falls back to the top-level `windowMs` when omitted. */
  windowMs?: number;
  maxCalls: number;
};

export type RateLimitConfig = {
  windowMs: number;
  maxCalls: number;
  /** Also keep a bucket per tool name. Default: true. */
  perTool?: boolean;
  /** Also keep a bucket per caller identity. Requires `identify()`. Default: false. */
  perIdentity?: boolean;
  /** Tighter or looser limits for specific tools. First match wins. */
  overrides?: RateLimitOverride[];
  /**
   * Cap on tracked per-tool / per-identity buckets. Least-recently-used buckets
   * are evicted past this, so an attacker cycling identities cannot grow memory
   * without bound. Default: 10_000.
   */
  maxBuckets?: number;
};

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterMs: number; scope: RateLimitScope; limit: number; windowMs: number };

const DEFAULT_MAX_BUCKETS = 10_000;

/**
 * Token-bucket limiter with global, per-tool, per-identity, and per-pattern
 * scopes. All applicable buckets are checked before any is consumed, so a call
 * rejected by a narrow bucket does not silently burn global budget.
 */
export class RateLimiter {
  private readonly global: TokenBucket;
  private readonly tools = new Map<string, TokenBucket>();
  private readonly identities = new Map<string, TokenBucket>();
  private readonly overrides = new Map<string, TokenBucket>();
  private readonly config: RateLimitConfig;
  private readonly maxBuckets: number;

  constructor(config: RateLimitConfig) {
    if (!(config.maxCalls > 0)) {
      throw new RangeError("mcp-policy-guard: rateLimit.maxCalls must be > 0");
    }
    if (!(config.windowMs > 0)) {
      throw new RangeError("mcp-policy-guard: rateLimit.windowMs must be > 0");
    }
    this.config = config;
    this.maxBuckets = config.maxBuckets ?? DEFAULT_MAX_BUCKETS;
    this.global = this.createBucket(config.maxCalls, config.windowMs);
  }

  check(toolName: string, identity?: string): RateLimitResult {
    const override = this.config.overrides?.find((o) => matchAnyGlob(o.patterns, toolName));

    const candidates: Array<{ scope: RateLimitScope; bucket: TokenBucket; limit: number; windowMs: number }> =
      [
        {
          scope: "global",
          bucket: this.global,
          limit: this.config.maxCalls,
          windowMs: this.config.windowMs,
        },
      ];

    if (override) {
      const windowMs = override.windowMs ?? this.config.windowMs;
      candidates.push({
        scope: "override",
        bucket: this.bucketFor(this.overrides, toolName, override.maxCalls, windowMs),
        limit: override.maxCalls,
        windowMs,
      });
    } else if (this.config.perTool !== false) {
      candidates.push({
        scope: "tool",
        bucket: this.bucketFor(this.tools, toolName, this.config.maxCalls, this.config.windowMs),
        limit: this.config.maxCalls,
        windowMs: this.config.windowMs,
      });
    }

    if (this.config.perIdentity === true && typeof identity === "string") {
      candidates.push({
        scope: "identity",
        bucket: this.bucketFor(this.identities, identity, this.config.maxCalls, this.config.windowMs),
        limit: this.config.maxCalls,
        windowMs: this.config.windowMs,
      });
    }

    for (const candidate of candidates) {
      if (!candidate.bucket.canTake()) {
        return {
          ok: false,
          retryAfterMs: candidate.bucket.retryAfterMs(),
          scope: candidate.scope,
          limit: candidate.limit,
          windowMs: candidate.windowMs,
        };
      }
    }

    for (const candidate of candidates) candidate.bucket.consume();
    return { ok: true };
  }

  /** Drop all per-tool and per-identity state. The global bucket is rebuilt too. */
  reset(): void {
    this.tools.clear();
    this.identities.clear();
    this.overrides.clear();
  }

  /** Number of live buckets, for diagnostics and leak tests. */
  get size(): number {
    return this.tools.size + this.identities.size + this.overrides.size;
  }

  private bucketFor(
    map: Map<string, TokenBucket>,
    key: string,
    maxCalls: number,
    windowMs: number,
  ): TokenBucket {
    const existing = map.get(key);
    if (existing) {
      // Re-insert so Map iteration order approximates least-recently-used.
      map.delete(key);
      map.set(key, existing);
      return existing;
    }

    if (map.size >= this.maxBuckets) {
      const oldest = map.keys().next();
      if (!oldest.done) map.delete(oldest.value);
    }

    const bucket = this.createBucket(maxCalls, windowMs);
    map.set(key, bucket);
    return bucket;
  }

  private createBucket(maxCalls: number, windowMs: number): TokenBucket {
    return new TokenBucket({ capacity: maxCalls, refillPerMs: maxCalls / windowMs });
  }
}
