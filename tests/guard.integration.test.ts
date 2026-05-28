import { describe, expect, it } from "vitest";
import { createGuardedHandler } from "../src/guard.js";
import { allow, deny, requireConfirmation } from "../src/policy/types.js";
import { InMemoryConfirmationStore } from "../src/confirmation/tokens.js";
import type { ToolCallHandler, ToolCallResult } from "../src/types.js";

const inner: ToolCallHandler = async (req) => {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          tool: req.params.name,
          args: req.params.arguments,
          email: "user@example.com",
        }),
      },
    ],
  };
};

function parse(result: ToolCallResult): Record<string, unknown> {
  const text = result.content[0]?.text ?? "{}";
  return JSON.parse(text) as Record<string, unknown>;
}

describe("createGuardedHandler integration", () => {
  it("allows, denies, confirms, redacts", async () => {
    const store = new InMemoryConfirmationStore();
    const audits: unknown[] = [];
    const handler = createGuardedHandler(inner, {
      policies: [
        allow("search_*"),
        requireConfirmation("delete_*"),
        deny("admin_*"),
      ],
      rateLimit: { windowMs: 60_000, maxCalls: 50, perTool: true },
      audit: { sink: (e) => { audits.push(e); } },
      redact: { patterns: ["email"] },
      confirmationStore: store,
    });

    const allowed = await handler({ params: { name: "search_contacts", arguments: { q: "a" } } });
    expect(allowed.isError).toBeFalsy();
    expect(parse(allowed).email).toBe("[REDACTED]");

    const denied = await handler({ params: { name: "admin_wipe", arguments: {} } });
    expect(denied.isError).toBe(true);
    expect(parse(denied).error).toBe("denied");

    const first = await handler({
      params: { name: "delete_contact", arguments: { id: "1" } },
    });
    expect(first.isError).toBe(true);
    const body = parse(first);
    expect(body.error).toBe("confirmation_required");
    const token = body.confirmationToken as string;

    const second = await handler({
      params: {
        name: "delete_contact",
        arguments: { id: "1", confirmationToken: token },
      },
    });
    expect(second.isError).toBeFalsy();
    expect(audits.length).toBeGreaterThanOrEqual(3);
  });
});
