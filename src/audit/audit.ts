import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { hashArgs } from "../confirmation/tokens.js";
import { getLogger } from "../logger.js";
import { redactArgs, type RedactConfig } from "../redact/redact.js";

export type AuditOutcome =
  | "success"
  | "error"
  | "denied"
  | "confirmation_required"
  | "timeout";

/** Named fields of an audit entry. {@link AuditEntry} adds room for extras. */
export type AuditEntryFields = {
  /** ISO-8601 timestamp of when the entry was written. */
  ts: string;
  /** Correlation id shared by every entry for one tool call. */
  callId: string;
  tool: string;
  /** SHA-256 of the canonical argument JSON. Always present, even when args are omitted. */
  argsHash: string;
  /** Raw arguments — only when `includeArgs` is enabled. */
  args?: unknown;
  /** Policy action or guard stage that produced the outcome. */
  decision: string;
  /** Reason text from the matching policy rule, when there was one. */
  reason?: string;
  /** Caller identity, when `identify()` is configured. */
  identity?: string;
  latencyMs: number;
  outcome: AuditOutcome;
  error?: string;
};

/** An audit record: the named fields above plus any extras the guard adds. */
export type AuditEntry = AuditEntryFields & Record<string, unknown>;

export type AuditSinkFn = (entry: AuditEntry) => void | Promise<void>;

/** `"stdout"`, `"stderr"`, `"file"`, a callback, or an array combining them. */
export type AuditSink = "stdout" | "stderr" | "file" | AuditSinkFn | AuditSink[];

export type AuditConfig = {
  sink: AuditSink;
  /** Record raw arguments alongside the hash. Off by default — arguments often carry PII. */
  includeArgs?: boolean;
  /** Redact arguments before recording them. Applied only when `includeArgs` is on. */
  redact?: RedactConfig;
  /** Destination for the `"file"` sink. Default: `mcp-policy-guard-audit.jsonl`. */
  filePath?: string;
  /** Only record entries whose outcome is in this list. Default: all. */
  outcomes?: AuditOutcome[];
  /**
   * Await sink writes before the tool result is returned. Turning this off
   * keeps latency off the critical path at the cost of ordering guarantees.
   * Default: true.
   */
  await?: boolean;
};

export type AuditInput = Omit<AuditEntryFields, "ts" | "argsHash" | "args" | "callId"> & {
  args: unknown;
  callId?: string;
} & Record<string, unknown>;

let counter = 0;

/** Monotonic per-process identifier used to correlate entries for one call. */
export function nextCallId(): string {
  counter = (counter + 1) % Number.MAX_SAFE_INTEGER;
  return `${process.pid.toString(36)}-${counter.toString(36)}`;
}

/**
 * Write one audit entry.
 *
 * A sink that throws is logged and swallowed: audit is an observability
 * concern and must never turn a permitted tool call into a failed one.
 */
export async function writeAudit(
  config: AuditConfig | undefined,
  input: AuditInput,
): Promise<void> {
  if (!config) return;
  if (config.outcomes && !config.outcomes.includes(input.outcome)) return;

  const { args, callId, ...rest } = input;

  const entry: AuditEntry = {
    ts: new Date().toISOString(),
    callId: callId ?? nextCallId(),
    ...rest,
    argsHash: hashArgs(args),
  };

  if (config.includeArgs) {
    entry.args = config.redact ? redactArgs(args, config.redact) : args;
  }

  const promise = emit(config, entry);
  if (config.await === false) {
    void promise.catch(() => undefined);
    return;
  }
  await promise;
}

async function emit(config: AuditConfig, entry: AuditEntry): Promise<void> {
  try {
    await emitTo(config.sink, config, entry);
  } catch (err) {
    getLogger().warn(
      { err: err instanceof Error ? err.message : String(err) },
      "audit sink failed",
    );
  }
}

async function emitTo(sink: AuditSink, config: AuditConfig, entry: AuditEntry): Promise<void> {
  if (Array.isArray(sink)) {
    // Settle every sink even if one rejects, so a broken sink cannot mask the rest.
    const results = await Promise.allSettled(sink.map((s) => emitTo(s, config, entry)));
    const failure = results.find((r) => r.status === "rejected");
    if (failure && failure.status === "rejected") throw failure.reason;
    return;
  }

  if (typeof sink === "function") {
    await sink(entry);
    return;
  }

  const line = `${JSON.stringify(entry)}\n`;

  if (sink === "stdout") {
    process.stdout.write(line);
    return;
  }
  if (sink === "stderr") {
    process.stderr.write(line);
    return;
  }

  const filePath = config.filePath ?? "mcp-policy-guard-audit.jsonl";
  await mkdir(dirname(filePath), { recursive: true }).catch(() => undefined);
  await appendFile(filePath, line, "utf8");
}
