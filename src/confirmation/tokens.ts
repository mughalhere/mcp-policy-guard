import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  CONFIRMATION_TTL_MS,
  type ConfirmationStore,
  InMemoryConfirmationStore,
} from "./store.js";

/**
 * Deterministic JSON with object keys sorted at every depth, so
 * `{a: 1, b: 2}` and `{b: 2, a: 1}` hash identically. Without this, a client
 * that re-serialises arguments in a different key order on the confirmation
 * retry would trip the args-mismatch check.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = canonicalize(source[key]);
    return out;
  }
  return value;
}

/** SHA-256 of the canonical JSON form of `args`. */
export function hashArgs(args: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(args ?? {}))).digest("hex");
}

/** 192 bits of CSPRNG entropy, hex encoded. */
export function createConfirmationToken(): string {
  return randomBytes(24).toString("hex");
}

function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export type IssueConfirmationOptions = {
  /** Token lifetime in ms. Default: {@link CONFIRMATION_TTL_MS} (5 minutes). */
  ttlMs?: number;
  /** Bind the token to a caller identity; a different caller cannot redeem it. */
  identity?: string;
};

export async function issueConfirmation(
  store: ConfirmationStore,
  toolName: string,
  args: unknown,
  options: IssueConfirmationOptions = {},
): Promise<{ token: string; expiresAt: number }> {
  const ttlMs = options.ttlMs ?? CONFIRMATION_TTL_MS;
  if (!(ttlMs > 0)) throw new RangeError("mcp-policy-guard: confirmation ttlMs must be > 0");

  const token = createConfirmationToken();
  const issuedAt = Date.now();
  const expiresAt = issuedAt + ttlMs;
  const record = {
    token,
    toolName,
    argsHash: hashArgs(args),
    expiresAt,
    used: false,
    issuedAt,
    ...(options.identity !== undefined ? { identity: options.identity } : {}),
  };
  await store.set(record);
  return { token, expiresAt };
}

export type ConsumeConfirmationOptions = {
  /** Identity presenting the token. Must match the one it was issued to. */
  identity?: string;
};

export type ConsumeResult = { ok: true } | { ok: false; reason: string };

/**
 * Validate and burn a confirmation token.
 *
 * Every check is enforced here rather than delegated to the store, so a custom
 * `ConfirmationStore` that forgets to filter expired or used records cannot
 * weaken the gate.
 */
export async function consumeConfirmation(
  store: ConfirmationStore,
  token: string,
  toolName: string,
  args: unknown,
  options: ConsumeConfirmationOptions = {},
): Promise<ConsumeResult> {
  const record = await store.get(token);
  if (!record) return { ok: false, reason: "Invalid or expired confirmation token" };
  if (record.expiresAt < Date.now()) return { ok: false, reason: "Confirmation token expired" };
  if (record.used) return { ok: false, reason: "Confirmation token already used" };
  if (record.toolName !== toolName) return { ok: false, reason: "Confirmation token tool mismatch" };
  if (!hashesEqual(record.argsHash, hashArgs(args))) {
    return { ok: false, reason: "Confirmation token args mismatch" };
  }
  if (record.identity !== undefined && record.identity !== options.identity) {
    return { ok: false, reason: "Confirmation token identity mismatch" };
  }
  await store.markUsed(token);
  return { ok: true };
}

/** Invalidate a token before it is used. No-op if the store cannot delete. */
export async function revokeConfirmation(
  store: ConfirmationStore,
  token: string,
): Promise<void> {
  if (store.delete) {
    await store.delete(token);
    return;
  }
  await store.markUsed(token);
}

export function defaultConfirmationStore(): ConfirmationStore {
  return new InMemoryConfirmationStore();
}

export { CONFIRMATION_TTL_MS, InMemoryConfirmationStore };
export type { ConfirmationStore };
