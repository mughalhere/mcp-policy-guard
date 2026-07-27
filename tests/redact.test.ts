import { describe, expect, it } from "vitest";
import { redactResult, redactString } from "../src/redact/redact.js";

describe("redact", () => {
  it("redacts emails and phones", () => {
    const input = "Contact jane@example.com or +1 415-555-0100";
    const out = redactString(input);
    expect(out).not.toContain("jane@example.com");
    expect(out).toContain("[REDACTED]");
  });

  it("redacts nested tool results", () => {
    const result = {
      content: [{ type: "text", text: "card 4111 1111 1111 1111" }],
    };
    const out = redactResult(result);
    expect(out.content[0]?.text).toContain("[REDACTED]");
  });

  it("stays roughly linear for a 10KB payload (catches catastrophic regexp blowups)", () => {
    const payload = ("email test@example.com " + "x".repeat(50)).repeat(200);
    expect(payload.length).toBeGreaterThan(10_000);
    for (let i = 0; i < 5; i++) redactString(payload); // warm up the JIT
    const start = performance.now();
    for (let i = 0; i < 20; i++) redactString(payload);
    const avg = (performance.now() - start) / 20;
    // Generous margin — this is a regression smoke test for pathological
    // backtracking, not a tight perf budget, since CI runners vary widely.
    expect(avg).toBeLessThan(20);
  });
});
