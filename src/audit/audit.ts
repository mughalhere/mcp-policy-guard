import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { hashArgs } from "../confirmation/tokens.js";

export type AuditEntry = {
  ts: string;
  tool: string;
  argsHash: string;
  args?: unknown;
  decision: string;
  latencyMs: number;
  outcome: "success" | "error" | "denied" | "confirmation_required";
  error?: string;
};

export type AuditSink = "stdout" | "file" | ((entry: AuditEntry) => void | Promise<void>);

export type AuditConfig = {
  sink: AuditSink;
  includeArgs?: boolean;
  filePath?: string;
};

export async function writeAudit(
  config: AuditConfig | undefined,
  partial: Omit<AuditEntry, "ts" | "argsHash" | "args"> & { args: unknown },
): Promise<void> {
  if (!config) return;

  const entry: AuditEntry = {
    ts: new Date().toISOString(),
    tool: partial.tool,
    argsHash: hashArgs(partial.args),
    decision: partial.decision,
    latencyMs: partial.latencyMs,
    outcome: partial.outcome,
  };
  if (partial.error) entry.error = partial.error;
  if (config.includeArgs) entry.args = partial.args;

  const line = JSON.stringify(entry);

  if (typeof config.sink === "function") {
    await config.sink(entry);
    return;
  }
  if (config.sink === "stdout") {
    process.stdout.write(`${line}\n`);
    return;
  }
  const filePath = config.filePath ?? "mcp-policy-guard-audit.jsonl";
  await mkdir(dirname(filePath), { recursive: true }).catch(() => undefined);
  await appendFile(filePath, `${line}\n`, "utf8");
}
