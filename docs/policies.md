# Writing policies

A policy list is the security-relevant part of your configuration. This guide
covers how rules resolve, how to express intent without leaving gaps, and the
mistakes that look safe but aren't.

- [How a decision is reached](#how-a-decision-is-reached)
- [Naming and patterns](#naming-and-patterns)
- [Conditions](#conditions)
- [Identity scoping](#identity-scoping)
- [Common shapes](#common-shapes)
- [Anti-patterns](#anti-patterns)
- [Testing your policy](#testing-your-policy)

---

## How a decision is reached

For each call, rules are consulted by **kind**, in a fixed order:

```
1. deny                 → reject
2. requireConfirmation  → gate
3. allow                → run
4. no match             → deny, unless defaultAllow is true
```

Declaration order does not matter across kinds. It matters only *within* a kind:
the first matching rule of that kind supplies the `reason`.

Two consequences worth internalising:

- **A `deny` cannot be overridden by an `allow`.** Writing `allow("*")` after
  `deny("admin_*")` does not re-enable admin tools. This is deliberate — an
  accidental broad allow cannot punch a hole in an explicit deny.
- **`allow("*")` is the whole policy.** If you write it, every rule that isn't a
  `deny` or `requireConfirmation` becomes decorative. Prefer enumerating.

A rule matches when **all** of its constraints hold: the tool name matches a
pattern, `identities` (if set) matches, and `when` (if set) returns true. A
condition that throws counts as *not matching*, so an `allow` whose condition
blows up falls through to default deny.

## Naming and patterns

Policies are only as good as your tool names. A server whose tools are
`getData`, `doThing`, and `process` cannot be governed by patterns at all.

Name tools with a verb prefix that reflects blast radius:

```
list_*, get_*, search_*     read-only
create_*, update_*          writes
delete_*, purge_*, drop_*   destructive
admin_*                     never exposed
```

Then the policy reads like a sentence:

```ts
policies: [
  allow("{list,get,search}_*"),
  requireConfirmation("{create,update,delete}_*"),
  deny("admin_*"),
]
```

### Pattern reference

| Pattern | Matches | Note |
| --- | --- | --- |
| `search_*` | `search_files`, `search_` | `*` also matches empty |
| `*_delete` | `soft_delete` | suffix match |
| `tool_?` | `tool_a` only | exactly one character |
| `{get,list}_users` | either prefix | alternation |
| `!admin_*` | vetoes | see below |

Negation vetoes an entire pattern list:

```ts
allow("*", "!admin_*", "!internal_*")   // everything except those two families
```

This is convenient but inverts the default-deny posture — you are now
enumerating what is forbidden rather than what is permitted. Prefer it only when
the tool set is stable and small.

## Conditions

`when` lets a rule inspect the actual arguments.

### Confining a path

```ts
import { allow, argStartsWith } from "mcp-policy-guard";

allow("read_file", { when: argStartsWith("path", "/workspace/") })
```

`argStartsWith` is a string prefix check, not a path resolver. It does not
canonicalise `..`. If your tool accepts relative paths or symlinks, resolve them
inside the tool as well — the guard governs the call, not the filesystem.

```ts
allow("read_file", {
  when: (ctx) => {
    const path = ctx.args.path;
    return typeof path === "string" && resolve(path).startsWith("/workspace/");
  },
})
```

### Escalating on a risky argument

Same tool, different treatment depending on what it is pointed at:

```ts
policies: [
  requireConfirmation("deploy", { when: argEquals("env", "prod") }),
  allow("deploy"),
]
```

Dev deploys run; prod deploys need a human. Precedence does the work — the
`requireConfirmation` is checked before the `allow`.

### Narrowing an operation

```ts
policies: [
  deny("run_sql", {
    when: not(argStartsWith("query", "SELECT")),
    reason: "only SELECT statements are permitted",
  }),
  allow("run_sql"),
]
```

A prefix check is a coarse filter — `SELECT … ; DROP TABLE` still passes. Treat
conditions as a policy layer, not a parser; the tool itself should still use a
read-only connection.

### Rejecting bad input

Conditions decide *permission*. For "these arguments are malformed", use
`validate` instead — it produces `invalid_arguments` rather than `denied`, which
tells the model something different and more actionable:

```ts
validate: (ctx) =>
  ctx.tool === "search" && typeof ctx.args.q !== "string" ? "search requires a string `q`" : true,
```

## Identity scoping

With `identify()` configured, rules can be restricted to callers:

```ts
identify: (request, extra) => extra?.sessionId,

policies: [
  allow("admin_*", { identities: ["ops-*"] }),
  allow("search_*"),
]
```

An anonymous caller (no identity, or a throwing `identify`) never matches an
identity-scoped rule, so this fails closed.

`identityIs()` does the same thing inside a condition, which composes:

```ts
requireConfirmation("delete_*", { when: not(identityIs("service-account-*")) })
```

Trusted service accounts skip the gate; humans and agents do not.

## Common shapes

### Read-only server

```ts
policies: [allow("{list,get,search,read}_*")]
```

Everything else is denied by default, including tools added later — which is the
point.

### Staged rollout of a new tool

```ts
policies: [
  requireConfirmation("new_experimental_tool"),
  allow("{list,get}_*"),
]
```

Every call is gated while you watch the audit log, then relax to `allow`.

### Read/write split with an escape hatch

```ts
policies: [
  deny("*_dangerous"),
  requireConfirmation("{create,update,delete}_*"),
  allow("{list,get,search}_*"),
  allow("{create,update}_*", { identities: ["automation-*"] }),
]
```

Note the last rule does **not** work as an override: the `requireConfirmation`
is evaluated first and wins. To exempt automation, put the condition on the gate
instead:

```ts
requireConfirmation("{create,update,delete}_*", { when: not(identityIs("automation-*")) }),
allow("{create,update,delete}_*", { identities: ["automation-*"] }),
```

### Policy from a file

```ts
import { policiesFromConfig } from "mcp-policy-guard";

const policies = policiesFromConfig(JSON.parse(await readFile("policy.json", "utf8")));
```

Conditions cannot be serialised — combine file-driven name rules with a small
number of code-defined conditional rules.

## Anti-patterns

**`defaultAllow: true` "for now".** It inverts the entire posture, and a tool
added six months later is exposed by default. If you need it during
development, gate it on an environment variable so it cannot reach production.

**Relying on `tools/list` filtering as a control.** Hidden tools are still
callable if the model guesses the name — filtering is ergonomics. The `deny`
rule is what stops the call.

**A confirmation gate the model can satisfy alone.** If the agent both receives
the token and retries the call, you have added a speed bump, not a human. For a
real human-in-the-loop, use `confirmation.approve` with an out-of-band channel.

**Conditions that fail open.** Write conditions so the *permissive* outcome
requires positive evidence:

```ts
// Good: must prove the prefix
allow("read_file", { when: argStartsWith("path", "/workspace/") })

// Bad: absent argument slips through
allow("read_file", { when: (ctx) => !String(ctx.args.path ?? "").startsWith("/etc") })
```

**Trusting arguments the guard already redacted.** With
`redact.arguments: true`, the tool receives redacted values. Do not enable it on
tools that need the real values.

## Testing your policy

Policy is code — test the denials, not just the permissions. `evaluatePolicy` is
exported for exactly this and needs no server:

```ts
import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "mcp-policy-guard";
import { policies } from "../src/policy.js";

describe("policy", () => {
  it("permits reads", () => {
    expect(evaluatePolicy("list_contacts", policies).action).toBe("allow");
  });

  it("gates deletes", () => {
    expect(evaluatePolicy("delete_contact", policies).action).toBe("requireConfirmation");
  });

  it("refuses anything unlisted", () => {
    expect(evaluatePolicy("tool_we_add_next_year", policies).action).toBe("deny");
  });

  it("confines reads to the workspace", () => {
    const inside = { tool: "read_file", args: { path: "/workspace/a" } };
    const outside = { tool: "read_file", args: { path: "/etc/shadow" } };
    expect(evaluatePolicy(inside, policies).action).toBe("allow");
    expect(evaluatePolicy(outside, policies).action).toBe("deny");
  });
});
```

The third test is the important one: it fails the day someone adds a tool
without adding a rule.
