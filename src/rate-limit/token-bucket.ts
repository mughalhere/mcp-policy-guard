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

  take(): { ok: true } | { ok: false; retryAfterMs: number } {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return { ok: true };
    }
    const retryAfterMs = Math.ceil((1 - this.tokens) / this.refillPerMs);
    return { ok: false, retryAfterMs: Math.max(retryAfterMs, 1) };
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    this.lastRefill = now;
  }
}

export type RateLimitConfig = {
  windowMs: number;
  maxCalls: number;
  perTool?: boolean;
};

export class RateLimiter {
  private readonly global: TokenBucket;
  private readonly perTool = new Map<string, TokenBucket>();
  private readonly config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
    this.global = this.createBucket();
  }

  check(toolName: string): { ok: true } | { ok: false; retryAfterMs: number } {
    const globalResult = this.global.take();
    if (!globalResult.ok) return globalResult;

    if (this.config.perTool !== false) {
      let bucket = this.perTool.get(toolName);
      if (!bucket) {
        bucket = this.createBucket();
        this.perTool.set(toolName, bucket);
      }
      return bucket.take();
    }
    return { ok: true };
  }

  private createBucket(): TokenBucket {
    const { windowMs, maxCalls } = this.config;
    return new TokenBucket({
      capacity: maxCalls,
      refillPerMs: maxCalls / windowMs,
    });
  }
}
