import { describe, expect, it, vi } from "vitest";
import { createGuardedHandler, guard } from "../src/guard.js";
import { GuardMetrics } from "../src/metrics.js";
import { argStartsWith } from "../src/policy/conditions.js";
import { allow, deny, requireConfirmation } from "../src/policy/types.js";
import type { GuardEvent, ToolCallHandler, ToolCallResult } from "../src/types.js";

const echo: ToolCallHandler = async (req) => ({
  content: [{ type: "text", text: JSON.stringify({ tool: req.params.name, args: req.params.arguments }) }],
});

function parse(result: ToolCallResult): Record<string, unknown> {
  return JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;
}

describe("identity", () => {
  it("routes policy, audit, and token binding through identify()", async () => {
    const events: GuardEvent[] = [];
    const handler = createGuardedHandler(echo, {
      policies: [allow("admin_*", { identities: ["ops-*"] }), allow("search_*")],
      identify: (_req, extra) => (extra as { user?: string } | undefined)?.user,
      onDecision: (e) => void events.push(e),
    });

    const asOps = await handler({ params: { name: "admin_wipe", arguments: {} } }, { user: "ops-jane" });
    expect(asOps.isError).toBeFalsy();

    const asUser = await handler({ params: { name: "admin_wipe", arguments: {} } }, { user: "user-bob" });
    expect(parse(asUser).error).toBe("denied");

    expect(events.map((e) => e.identity)).toEqual(["ops-jane", "user-bob"]);
  });

  it("treats a throwing identify() as anonymous rather than failing the call", async () => {
    const handler = createGuardedHandler(echo, {
      policies: [allow("search_*")],
      identify: () => {
        throw new Error("no session");
      },
    });
    const result = await handler({ params: { name: "search_x", arguments: {} } });
    expect(result.isError).toBeFalsy();
  });

  it("refuses a confirmation token redeemed by a different identity", async () => {
    const handler = createGuardedHandler(echo, {
      policies: [requireConfirmation("delete_*")],
      identify: (_req, extra) => (extra as { user?: string } | undefined)?.user,
    });

    const issued = await handler({ params: { name: "delete_x", arguments: { id: "1" } } }, { user: "alice" });
    const token = parse(issued).confirmationToken as string;

    const stolen = await handler(
      { params: { name: "delete_x", arguments: { id: "1", confirmationToken: token } } },
      { user: "mallory" },
    );
    expect(parse(stolen).error).toBe("confirmation_failed");
    expect(parse(stolen).message).toMatch(/identity mismatch/i);

    const legit = await handler(
      { params: { name: "delete_x", arguments: { id: "1", confirmationToken: token } } },
      { user: "alice" },
    );
    expect(legit.isError).toBeFalsy();
  });
});

describe("confirmation options", () => {
  it("honours a custom ttl and token key", async () => {
    const handler = createGuardedHandler(echo, {
      policies: [requireConfirmation("delete_*")],
      confirmation: { ttlMs: 1_000, tokenKey: "approvalId" },
    });
    const issued = await handler({ params: { name: "delete_x", arguments: { id: "1" } } });
    const body = parse(issued);
    expect(body.hint).toContain("approvalId");
    const expiresIn = new Date(body.expiresAt as string).getTime() - Date.now();
    expect(expiresIn).toBeLessThanOrEqual(1_000);

    const retry = await handler({
      params: { name: "delete_x", arguments: { id: "1", approvalId: body.confirmationToken } },
    });
    expect(retry.isError).toBeFalsy();
    // The token key is stripped before the tool sees the arguments.
    expect(parse(retry).args).toEqual({ id: "1" });
  });

  it("rejects a replayed token", async () => {
    const handler = createGuardedHandler(echo, { policies: [requireConfirmation("delete_*")] });
    const issued = await handler({ params: { name: "delete_x", arguments: { id: "1" } } });
    const token = parse(issued).confirmationToken as string;
    const args = { id: "1", confirmationToken: token };

    expect((await handler({ params: { name: "delete_x", arguments: args } })).isError).toBeFalsy();
    const replay = await handler({ params: { name: "delete_x", arguments: args } });
    expect(parse(replay).message).toMatch(/already used/i);
  });

  it("rejects a token reused with different arguments", async () => {
    const handler = createGuardedHandler(echo, { policies: [requireConfirmation("delete_*")] });
    const issued = await handler({ params: { name: "delete_x", arguments: { id: "1" } } });
    const token = parse(issued).confirmationToken as string;

    const swapped = await handler({
      params: { name: "delete_x", arguments: { id: "999", confirmationToken: token } },
    });
    expect(parse(swapped).message).toMatch(/args mismatch/i);
  });

  it("accepts arguments reordered on the retry", async () => {
    const handler = createGuardedHandler(echo, { policies: [requireConfirmation("delete_*")] });
    const issued = await handler({ params: { name: "delete_x", arguments: { a: 1, b: 2 } } });
    const token = parse(issued).confirmationToken as string;

    const retry = await handler({
      params: { name: "delete_x", arguments: { b: 2, confirmationToken: token, a: 1 } },
    });
    expect(retry.isError).toBeFalsy();
  });

  it("supports an out-of-band approver instead of a token round-trip", async () => {
    const approve = vi.fn(async () => true);
    const handler = createGuardedHandler(echo, {
      policies: [requireConfirmation("delete_*")],
      confirmation: { approve },
    });

    const result = await handler({ params: { name: "delete_x", arguments: { id: "1" } } });
    expect(result.isError).toBeFalsy();
    expect(approve).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "delete_x", args: { id: "1" } }),
    );
  });

  it("treats a refusing or throwing approver as a denial", async () => {
    const refuse = createGuardedHandler(echo, {
      policies: [requireConfirmation("delete_*")],
      confirmation: { approve: () => false },
    });
    expect(parse(await refuse({ params: { name: "delete_x", arguments: {} } })).error).toBe(
      "confirmation_failed",
    );

    const boom = createGuardedHandler(echo, {
      policies: [requireConfirmation("delete_*")],
      confirmation: {
        approve: () => {
          throw new Error("approver offline");
        },
      },
    });
    const result = parse(await boom({ params: { name: "delete_x", arguments: {} } }));
    expect(result.error).toBe("confirmation_failed");
    expect(result.message).toBe("approver offline");
  });
});

describe("validate", () => {
  it("rejects with the returned message", async () => {
    const handler = createGuardedHandler(echo, {
      policies: [allow("write_*")],
      validate: (ctx) => (typeof ctx.args.path === "string" ? true : "path is required"),
    });

    const bad = await handler({ params: { name: "write_file", arguments: {} } });
    expect(parse(bad).error).toBe("invalid_arguments");
    expect(parse(bad).message).toBe("path is required");

    const good = await handler({ params: { name: "write_file", arguments: { path: "/tmp/a" } } });
    expect(good.isError).toBeFalsy();
  });

  it("runs before a confirmation token is issued", async () => {
    const handler = createGuardedHandler(echo, {
      policies: [requireConfirmation("delete_*")],
      validate: () => "never valid",
    });
    const result = await handler({ params: { name: "delete_x", arguments: {} } });
    expect(parse(result).error).toBe("invalid_arguments");
    expect(parse(result).confirmationToken).toBeUndefined();
  });
});

describe("timeout", () => {
  it("returns a timeout error when the tool overruns", async () => {
    const slow: ToolCallHandler = () => new Promise((resolve) => setTimeout(resolve, 500));
    const handler = createGuardedHandler(slow, { policies: [allow("*")], timeoutMs: 20 });
    const result = await handler({ params: { name: "slow_tool", arguments: {} } });
    expect(parse(result).error).toBe("timeout");
  });

  it("leaves fast calls untouched", async () => {
    const handler = createGuardedHandler(echo, { policies: [allow("*")], timeoutMs: 500 });
    expect((await handler({ params: { name: "fast", arguments: {} } })).isError).toBeFalsy();
  });
});

describe("rate limiting through the guard", () => {
  it("reports scope and retryAfterMs", async () => {
    const handler = createGuardedHandler(echo, {
      policies: [allow("*")],
      rateLimit: { windowMs: 60_000, maxCalls: 1 },
    });
    await handler({ params: { name: "a", arguments: {} } });
    const limited = parse(await handler({ params: { name: "a", arguments: {} } }));
    expect(limited.error).toBe("rate_limited");
    expect(limited.scope).toBe("global");
    expect(limited.retryAfterMs).toBeGreaterThan(0);
  });
});

describe("redaction direction", () => {
  it("redacts results by default and arguments on request", async () => {
    const seen: unknown[] = [];
    const recorder: ToolCallHandler = async (req) => {
      seen.push(req.params.arguments);
      return { content: [{ type: "text", text: "reply to jane@example.com" }] };
    };

    const handler = createGuardedHandler(recorder, {
      policies: [allow("*")],
      redact: { patterns: ["email"], arguments: true },
    });
    const result = await handler({ params: { name: "send", arguments: { to: "jane@example.com" } } });

    expect(seen[0]).toEqual({ to: "[REDACTED]" });
    expect(result.content[0]?.text).toBe("reply to [REDACTED]");
  });

  it("can leave results untouched", async () => {
    const handler = createGuardedHandler(
      async () => ({ content: [{ type: "text", text: "jane@example.com" }] }),
      { policies: [allow("*")], redact: { patterns: ["email"], results: false } },
    );
    const result = await handler({ params: { name: "x", arguments: {} } });
    expect(result.content[0]?.text).toBe("jane@example.com");
  });
});

describe("hooks and metrics", () => {
  it("feeds GuardMetrics from onDecision", async () => {
    const metrics = new GuardMetrics();
    const handler = createGuardedHandler(echo, {
      policies: [allow("search_*"), deny("admin_*"), requireConfirmation("delete_*")],
      rateLimit: { windowMs: 60_000, maxCalls: 2, perTool: false },
      onDecision: (e) => metrics.record(e),
    });

    await handler({ params: { name: "search_a", arguments: {} } });
    await handler({ params: { name: "admin_a", arguments: {} } });
    await handler({ params: { name: "delete_a", arguments: {} } });

    const snapshot = metrics.snapshot();
    expect(snapshot.calls).toBe(3);
    expect(snapshot.allowed).toBe(1);
    expect(snapshot.denied).toBe(1);
    expect(snapshot.rateLimited).toBe(1);
    expect(snapshot.byTool.search_a?.allowed).toBe(1);
  });

  it("swallows a throwing onDecision hook", async () => {
    const handler = createGuardedHandler(echo, {
      policies: [allow("*")],
      onDecision: () => {
        throw new Error("metrics backend down");
      },
    });
    expect((await handler({ params: { name: "x", arguments: {} } })).isError).toBeFalsy();
  });

  it("uses a custom error formatter", async () => {
    const handler = createGuardedHandler(echo, {
      policies: [deny("*")],
      formatError: (err) => ({ content: [{ type: "text", text: `blocked: ${err.error}` }], isError: true }),
    });
    const result = await handler({ params: { name: "x", arguments: {} } });
    expect(result.content[0]?.text).toBe("blocked: denied");
  });

  it("correlates the audit entry and the decision event by callId", async () => {
    const entries: Array<{ callId?: unknown }> = [];
    const events: GuardEvent[] = [];
    const handler = createGuardedHandler(echo, {
      policies: [allow("*")],
      audit: { sink: (e) => void entries.push(e) },
      onDecision: (e) => void events.push(e),
    });
    await handler({ params: { name: "x", arguments: {} } });
    expect(entries[0]?.callId).toBe(events[0]?.callId);
  });
});

describe("conditional policies through the guard", () => {
  it("evaluates arguments at call time", async () => {
    const handler = createGuardedHandler(echo, {
      policies: [allow("read_file", { when: argStartsWith("path", "/workspace/") })],
    });
    expect((await handler({ params: { name: "read_file", arguments: { path: "/workspace/a" } } })).isError).toBeFalsy();
    const blocked = await handler({ params: { name: "read_file", arguments: { path: "/etc/shadow" } } });
    expect(parse(blocked).error).toBe("denied");
  });
});

describe("guard(server)", () => {
  it("wraps the registered handler map and filters tools/list", async () => {
    const handlers = new Map<string, (req: unknown, extra?: unknown) => Promise<unknown>>();
    handlers.set("tools/call", (async () => ({ content: [{ type: "text", text: "ok" }] })) as never);
    handlers.set("tools/list", (async () => ({
      tools: [{ name: "search_files" }, { name: "admin_wipe" }],
    })) as never);
    const server = { server: { _requestHandlers: handlers } };

    guard(server as never, { policies: [allow("search_*"), deny("admin_*")] });

    const listed = (await handlers.get("tools/list")!({ params: {} })) as { tools: Array<{ name: string }> };
    expect(listed.tools.map((t) => t.name)).toEqual(["search_files"]);

    const denied = (await handlers.get("tools/call")!({
      params: { name: "admin_wipe", arguments: {} },
    })) as ToolCallResult;
    expect(parse(denied).error).toBe("denied");
  });

  it("reports a misconfigured server rather than silently passing calls through", async () => {
    const handlers = new Map<string, (req: unknown, extra?: unknown) => Promise<unknown>>();
    const server = { server: { _requestHandlers: handlers } };
    guard(server as never, { policies: [allow("*")] });

    const result = (await handlers.get("tools/call")!({
      params: { name: "anything", arguments: {} },
    })) as ToolCallResult;
    expect(parse(result).error).toBe("misconfigured");
  });

  it("throws when the object is not an MCP server", () => {
    expect(() => guard({} as never, {})).toThrow(/setRequestHandler/);
  });
});

describe("v0.1 compatibility", () => {
  it("still honours the deprecated top-level confirmation options", async () => {
    const handler = createGuardedHandler(echo, {
      policies: [requireConfirmation("delete_*")],
      confirmationTokenKey: "ok",
    });
    const issued = await handler({ params: { name: "delete_x", arguments: {} } });
    expect(parse(issued).hint).toContain("ok");
  });
});
