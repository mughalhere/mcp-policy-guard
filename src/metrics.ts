import type { GuardEvent } from "./types.js";

export type GuardMetricsSnapshot = {
  calls: number;
  allowed: number;
  denied: number;
  rateLimited: number;
  confirmationsRequired: number;
  confirmationsFailed: number;
  errors: number;
  timeouts: number;
  /** Per-tool counters, keyed by tool name. */
  byTool: Record<string, { calls: number; allowed: number; blocked: number; errors: number }>;
  /** Mean handler latency in ms across completed calls. */
  avgLatencyMs: number;
};

/**
 * In-process counters, fed by the `onDecision` hook:
 *
 * ```ts
 * const metrics = new GuardMetrics();
 * const handler = createGuardedHandler(inner, { onDecision: (e) => metrics.record(e) });
 * // later
 * metrics.snapshot();
 * ```
 *
 * Deliberately dependency-free — export it to Prometheus, OpenTelemetry, or a
 * health endpoint however your host prefers.
 */
export class GuardMetrics {
  private calls = 0;
  private allowed = 0;
  private denied = 0;
  private rateLimited = 0;
  private confirmationsRequired = 0;
  private confirmationsFailed = 0;
  private errors = 0;
  private timeouts = 0;
  private latencyTotal = 0;
  private latencySamples = 0;
  private readonly tools = new Map<
    string,
    { calls: number; allowed: number; blocked: number; errors: number }
  >();

  record(event: GuardEvent): void {
    this.calls++;
    const tool = this.toolEntry(event.tool);
    tool.calls++;

    if (typeof event.latencyMs === "number") {
      this.latencyTotal += event.latencyMs;
      this.latencySamples++;
    }

    switch (event.outcome) {
      case "success":
        this.allowed++;
        tool.allowed++;
        break;
      case "denied":
        if (event.decision === "rate_limited") this.rateLimited++;
        else if (event.decision === "confirmation_failed") this.confirmationsFailed++;
        else this.denied++;
        tool.blocked++;
        break;
      case "confirmation_required":
        this.confirmationsRequired++;
        tool.blocked++;
        break;
      case "timeout":
        this.timeouts++;
        this.errors++;
        tool.errors++;
        break;
      case "error":
        this.errors++;
        tool.errors++;
        break;
    }
  }

  snapshot(): GuardMetricsSnapshot {
    return {
      calls: this.calls,
      allowed: this.allowed,
      denied: this.denied,
      rateLimited: this.rateLimited,
      confirmationsRequired: this.confirmationsRequired,
      confirmationsFailed: this.confirmationsFailed,
      errors: this.errors,
      timeouts: this.timeouts,
      byTool: Object.fromEntries([...this.tools].map(([name, stats]) => [name, { ...stats }])),
      avgLatencyMs: this.latencySamples === 0 ? 0 : this.latencyTotal / this.latencySamples,
    };
  }

  reset(): void {
    this.calls = 0;
    this.allowed = 0;
    this.denied = 0;
    this.rateLimited = 0;
    this.confirmationsRequired = 0;
    this.confirmationsFailed = 0;
    this.errors = 0;
    this.timeouts = 0;
    this.latencyTotal = 0;
    this.latencySamples = 0;
    this.tools.clear();
  }

  private toolEntry(name: string) {
    let entry = this.tools.get(name);
    if (!entry) {
      entry = { calls: 0, allowed: 0, blocked: 0, errors: 0 };
      this.tools.set(name, entry);
    }
    return entry;
  }
}
