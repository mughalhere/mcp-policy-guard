import { describe, expect, it } from "vitest";
import { GuardMetrics } from "../src/metrics.js";
import type { GuardEvent } from "../src/types.js";

function event(partial: Partial<GuardEvent>): GuardEvent {
  return {
    callId: "1",
    tool: "t",
    args: {},
    decision: "allow",
    outcome: "success",
    latencyMs: 10,
    ...partial,
  };
}

describe("GuardMetrics", () => {
  it("separates denials, rate limits, and failed confirmations", () => {
    const metrics = new GuardMetrics();
    metrics.record(event({ outcome: "denied", decision: "deny" }));
    metrics.record(event({ outcome: "denied", decision: "rate_limited" }));
    metrics.record(event({ outcome: "denied", decision: "confirmation_failed" }));
    metrics.record(event({ outcome: "confirmation_required", decision: "requireConfirmation" }));

    const snapshot = metrics.snapshot();
    expect(snapshot.denied).toBe(1);
    expect(snapshot.rateLimited).toBe(1);
    expect(snapshot.confirmationsFailed).toBe(1);
    expect(snapshot.confirmationsRequired).toBe(1);
    expect(snapshot.calls).toBe(4);
  });

  it("counts timeouts as errors too", () => {
    const metrics = new GuardMetrics();
    metrics.record(event({ outcome: "timeout" }));
    expect(metrics.snapshot().timeouts).toBe(1);
    expect(metrics.snapshot().errors).toBe(1);
  });

  it("averages latency and breaks down by tool", () => {
    const metrics = new GuardMetrics();
    metrics.record(event({ tool: "a", latencyMs: 10 }));
    metrics.record(event({ tool: "a", latencyMs: 30 }));
    metrics.record(event({ tool: "b", latencyMs: 20, outcome: "error" }));

    const snapshot = metrics.snapshot();
    expect(snapshot.avgLatencyMs).toBe(20);
    expect(snapshot.byTool.a).toEqual({ calls: 2, allowed: 2, blocked: 0, errors: 0 });
    expect(snapshot.byTool.b?.errors).toBe(1);
  });

  it("hands out an immutable snapshot", () => {
    const metrics = new GuardMetrics();
    metrics.record(event({ tool: "a" }));
    const snapshot = metrics.snapshot();
    snapshot.byTool.a!.calls = 999;
    expect(metrics.snapshot().byTool.a?.calls).toBe(1);
  });

  it("resets", () => {
    const metrics = new GuardMetrics();
    metrics.record(event({}));
    metrics.reset();
    expect(metrics.snapshot().calls).toBe(0);
    expect(metrics.snapshot().avgLatencyMs).toBe(0);
  });
});
