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

  it("stays under 2ms for 10KB payload", () => {
    const payload = ("email test@example.com " + "x".repeat(50)).repeat(200);
    expect(payload.length).toBeGreaterThan(10_000);
    const start = performance.now();
    for (let i = 0; i < 20; i++) redactString(payload);
    const avg = (performance.now() - start) / 20;
    expect(avg).toBeLessThan(2);
  });
});
