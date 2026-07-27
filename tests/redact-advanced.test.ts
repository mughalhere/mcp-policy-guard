import { describe, expect, it } from "vitest";
import {
  DEFAULT_SENSITIVE_KEYS,
  luhnValid,
  redactResult,
  redactString,
} from "../src/redact/redact.js";

describe("builtin patterns", () => {
  it("redacts the strict set", () => {
    const input = [
      "ssn 123-45-6789",
      "ip 10.1.2.3",
      "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
      "key AKIAIOSFODNN7EXAMPLE",
      "auth Bearer abcdefghijklmnopqrstuvwx",
    ].join(" ");
    const out = redactString(input, { patterns: "strict" });
    expect(out).not.toContain("123-45-6789");
    expect(out).not.toContain("10.1.2.3");
    expect(out).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(out).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(out).not.toContain("abcdefghijklmnopqrstuvwx");
  });

  it("leaves non-selected patterns alone", () => {
    const out = redactString("ssn 123-45-6789 and jane@example.com", { patterns: ["email"] });
    expect(out).toContain("123-45-6789");
    expect(out).not.toContain("jane@example.com");
  });
});

describe("credit cards", () => {
  it("validates with Luhn before redacting", () => {
    expect(luhnValid("4111111111111111")).toBe(true);
    expect(luhnValid("4111111111111112")).toBe(false);

    const out = redactString("card 4111 1111 1111 1111 order 1234567890123456789");
    expect(out).not.toContain("4111 1111 1111 1111");
    // A 19-digit non-card number survives instead of being mangled.
    expect(out).toContain("1234567890123456789");
  });

  it("can be forced to redact every digit run", () => {
    const out = redactString("order 1234567890123456789", { luhn: false });
    expect(out).not.toContain("1234567890123456789");
  });

  it("can preserve the last four characters", () => {
    const out = redactString("card 4111111111111111", { preserveLast: 4 });
    expect(out).toBe("card [REDACTED]1111");
  });
});

describe("key-based redaction", () => {
  it("redacts values by key name regardless of content", () => {
    const out = redactResult(
      { user: "ada", password: "hunter2", nested: { api_token: "xyz", note: "fine" } },
      { keys: ["password", "*token*"] },
    );
    expect(out).toEqual({
      user: "ada",
      password: "[REDACTED]",
      nested: { api_token: "[REDACTED]", note: "fine" },
    });
  });

  it("matches key globs case-insensitively", () => {
    const out = redactResult({ Authorization: "Basic abc" }, { keys: [...DEFAULT_SENSITIVE_KEYS] });
    expect(out.Authorization).toBe("[REDACTED]");
  });
});

describe("structure handling", () => {
  it("survives circular references", () => {
    const node: Record<string, unknown> = { email: "a@b.com" };
    node.self = node;
    const out = redactResult(node) as Record<string, unknown>;
    expect(out.email).toBe("[REDACTED]");
    expect(out.self).toBe("[CIRCULAR]");
  });

  it("leaves class instances and Dates intact", () => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    const out = redactResult({ date, text: "a@b.com" });
    expect(out.date).toBe(date);
    expect(out.text).toBe("[REDACTED]");
  });

  it("stops descending past maxDepth", () => {
    const deep = { a: { b: { c: { d: "a@b.com" } } } };
    const out = redactResult(deep, { maxDepth: 2 });
    expect(out.a.b.c.d).toBe("a@b.com");
  });

  it("does not leak regex lastIndex between calls", () => {
    const config = { patterns: ["email"] };
    expect(redactString("a@b.com and c@d.com", config)).toBe("[REDACTED] and [REDACTED]");
    expect(redactString("a@b.com and c@d.com", config)).toBe("[REDACTED] and [REDACTED]");
  });
});
