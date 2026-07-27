import { describe, expect, it } from "vitest";
import { writeAudit, type AuditEntry } from "../src/audit/audit.js";

const base = {
  tool: "delete_contact",
  args: { id: "1", email: "jane@example.com" },
  decision: "allow",
  latencyMs: 3,
  outcome: "success",
} as const;

describe("writeAudit", () => {
  it("hashes args and omits them by default", async () => {
    const entries: AuditEntry[] = [];
    await writeAudit({ sink: (e) => void entries.push(e) }, { ...base });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.argsHash).toMatch(/^[0-9a-f]{64}$/);
    expect(entries[0]?.args).toBeUndefined();
    expect(entries[0]?.callId).toBeTruthy();
  });

  it("hashes args independent of key order", async () => {
    const entries: AuditEntry[] = [];
    const sink = { sink: (e: AuditEntry) => void entries.push(e) };
    await writeAudit(sink, { ...base, args: { a: 1, b: 2 } });
    await writeAudit(sink, { ...base, args: { b: 2, a: 1 } });
    expect(entries[0]?.argsHash).toBe(entries[1]?.argsHash);
  });

  it("includes and redacts args when asked", async () => {
    const entries: AuditEntry[] = [];
    await writeAudit(
      { sink: (e) => void entries.push(e), includeArgs: true, redact: { patterns: ["email"] } },
      { ...base },
    );
    expect(entries[0]?.args).toEqual({ id: "1", email: "[REDACTED]" });
  });

  it("fans out to multiple sinks", async () => {
    const a: AuditEntry[] = [];
    const b: AuditEntry[] = [];
    await writeAudit({ sink: [(e) => void a.push(e), (e) => void b.push(e)] }, { ...base });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it("swallows a throwing sink so audit cannot fail a tool call", async () => {
    await expect(
      writeAudit(
        {
          sink: () => {
            throw new Error("disk full");
          },
        },
        { ...base },
      ),
    ).resolves.toBeUndefined();
  });

  it("keeps writing to healthy sinks when one throws", async () => {
    const healthy: AuditEntry[] = [];
    await writeAudit(
      {
        sink: [
          () => {
            throw new Error("nope");
          },
          (e) => void healthy.push(e),
        ],
      },
      { ...base },
    );
    expect(healthy).toHaveLength(1);
  });

  it("filters by outcome", async () => {
    const entries: AuditEntry[] = [];
    const config = { sink: (e: AuditEntry) => void entries.push(e), outcomes: ["denied" as const] };
    await writeAudit(config, { ...base, outcome: "success" });
    await writeAudit(config, { ...base, outcome: "denied" });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.outcome).toBe("denied");
  });

  it("is a no-op without config", async () => {
    await expect(writeAudit(undefined, { ...base })).resolves.toBeUndefined();
  });
});
