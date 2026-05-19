import { createHash, randomBytes } from "node:crypto";
import {
  CONFIRMATION_TTL_MS,
  type ConfirmationStore,
  InMemoryConfirmationStore,
} from "./store.js";

export function hashArgs(args: unknown): string {
  return createHash("sha256").update(JSON.stringify(args ?? {})).digest("hex");
}

export function createConfirmationToken(): string {
  return randomBytes(24).toString("hex");
}

export async function issueConfirmation(
  store: ConfirmationStore,
  toolName: string,
  args: unknown,
): Promise<{ token: string; expiresAt: number }> {
  const token = createConfirmationToken();
  const expiresAt = Date.now() + CONFIRMATION_TTL_MS;
  await store.set({
    token,
    toolName,
    argsHash: hashArgs(args),
    expiresAt,
    used: false,
  });
  return { token, expiresAt };
}

export async function consumeConfirmation(
  store: ConfirmationStore,
  token: string,
  toolName: string,
  args: unknown,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const record = await store.get(token);
  if (!record) return { ok: false, reason: "Invalid or expired confirmation token" };
  if (record.used) return { ok: false, reason: "Confirmation token already used" };
  if (record.toolName !== toolName) return { ok: false, reason: "Confirmation token tool mismatch" };
  if (record.argsHash !== hashArgs(args)) return { ok: false, reason: "Confirmation token args mismatch" };
  await store.markUsed(token);
  return { ok: true };
}

export function defaultConfirmationStore(): ConfirmationStore {
  return new InMemoryConfirmationStore();
}

export { CONFIRMATION_TTL_MS, InMemoryConfirmationStore };
export type { ConfirmationStore };
