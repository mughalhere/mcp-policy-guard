import { describe, expect, it } from "vitest";
import { consumeConfirmation, hashArgs } from "../src/confirmation/tokens.js";
import type { ConfirmationRecord, ConfirmationStore } from "../src/confirmation/store.js";

/** A store that never evicts expired records — stands in for third-party
 * ConfirmationStore implementations that don't filter expiry in get(). */
class NaiveStore implements ConfirmationStore {
  private readonly map = new Map<string, ConfirmationRecord>();
  async set(record: ConfirmationRecord): Promise<void> {
    this.map.set(record.token, record);
  }
  async get(token: string): Promise<ConfirmationRecord | undefined> {
    return this.map.get(token);
  }
  async markUsed(token: string): Promise<void> {
    const record = this.map.get(token);
    if (record) record.used = true;
  }
}

describe("consumeConfirmation", () => {
  it("rejects an expired token even when the store doesn't filter it itself", async () => {
    const store = new NaiveStore();
    const token = "expired-token";
    await store.set({
      token,
      toolName: "delete_contact",
      argsHash: hashArgs({ id: "1" }),
      expiresAt: Date.now() - 1,
      used: false,
    });

    const result = await consumeConfirmation(store, token, "delete_contact", { id: "1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/expired/i);
  });
});
