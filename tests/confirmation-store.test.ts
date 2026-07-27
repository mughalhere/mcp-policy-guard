import { describe, expect, it } from "vitest";
import { InMemoryConfirmationStore } from "../src/confirmation/store.js";
import {
  consumeConfirmation,
  hashArgs,
  issueConfirmation,
  revokeConfirmation,
} from "../src/confirmation/tokens.js";

describe("hashArgs", () => {
  it("is independent of key order at every depth", () => {
    expect(hashArgs({ a: 1, b: { c: 2, d: 3 } })).toBe(hashArgs({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it("still distinguishes different values and array order", () => {
    expect(hashArgs({ a: 1 })).not.toBe(hashArgs({ a: 2 }));
    expect(hashArgs([1, 2])).not.toBe(hashArgs([2, 1]));
  });
});

describe("InMemoryConfirmationStore", () => {
  it("evicts expired and used records on sweep", async () => {
    const store = new InMemoryConfirmationStore();
    await store.set({ token: "a", toolName: "t", argsHash: "h", expiresAt: Date.now() - 1, used: false });
    await store.set({ token: "b", toolName: "t", argsHash: "h", expiresAt: Date.now() + 60_000, used: true });
    await store.set({ token: "c", toolName: "t", argsHash: "h", expiresAt: Date.now() + 60_000, used: false });

    expect(await store.sweep()).toBe(2);
    expect(store.size).toBe(1);
    expect(await store.get("c")).toBeDefined();
  });

  it("stays bounded under a token flood", async () => {
    const store = new InMemoryConfirmationStore({ maxEntries: 20 });
    for (let i = 0; i < 200; i++) {
      await issueConfirmation(store, "delete_x", { i });
    }
    expect(store.size).toBeLessThanOrEqual(20);
  });

  it("deletes on revoke", async () => {
    const store = new InMemoryConfirmationStore();
    const { token } = await issueConfirmation(store, "delete_x", { id: 1 });
    await revokeConfirmation(store, token);
    const result = await consumeConfirmation(store, token, "delete_x", { id: 1 });
    expect(result.ok).toBe(false);
  });
});

describe("issue/consume", () => {
  it("rejects a token issued for a different tool", async () => {
    const store = new InMemoryConfirmationStore();
    const { token } = await issueConfirmation(store, "delete_x", {});
    const result = await consumeConfirmation(store, token, "delete_y", {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/tool mismatch/i);
  });

  it("expires according to ttlMs", async () => {
    const store = new InMemoryConfirmationStore();
    const { token, expiresAt } = await issueConfirmation(store, "delete_x", {}, { ttlMs: 20 });
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(20);
    await new Promise((resolve) => setTimeout(resolve, 40));
    const result = await consumeConfirmation(store, token, "delete_x", {});
    expect(result.ok).toBe(false);
  });

  it("rejects a non-positive ttl", async () => {
    const store = new InMemoryConfirmationStore();
    await expect(issueConfirmation(store, "t", {}, { ttlMs: 0 })).rejects.toThrow(RangeError);
  });

  it("issues tokens with 48 hex characters of entropy", async () => {
    const store = new InMemoryConfirmationStore();
    const { token } = await issueConfirmation(store, "t", {});
    expect(token).toMatch(/^[0-9a-f]{48}$/);
  });
});
