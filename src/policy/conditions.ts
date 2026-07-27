import { matchAnyGlob } from "./glob.js";
import type { PolicyCondition, PolicyContext } from "./types.js";

/**
 * Composable predicates for the `when` option on policy rules. They exist so
 * common argument checks read declaratively:
 *
 * ```ts
 * allow("write_file", { when: argStartsWith("path", "/workspace/") })
 * deny("run_sql", { when: not(argMatches("query", /^select /i)) })
 * ```
 *
 * Any `(ctx) => boolean` works too — these are conveniences, not a required DSL.
 */

function read(context: PolicyContext, key: string): unknown {
  if (!key.includes(".")) return context.args[key];
  let current: unknown = context.args;
  for (const segment of key.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** True when the argument at `key` is strictly equal to any of `values`. */
export function argEquals(key: string, ...values: unknown[]): PolicyCondition {
  return (context) => values.includes(read(context, key));
}

/** True when the argument at `key` is a string matching `pattern`. */
export function argMatches(key: string, pattern: RegExp): PolicyCondition {
  return (context) => {
    const value = read(context, key);
    // Fresh RegExp per call: a caller-supplied /g pattern carries lastIndex.
    return typeof value === "string" && new RegExp(pattern.source, pattern.flags.replace("g", "")).test(value);
  };
}

/** True when the argument at `key` is a string starting with `prefix`. */
export function argStartsWith(key: string, prefix: string): PolicyCondition {
  return (context) => {
    const value = read(context, key);
    return typeof value === "string" && value.startsWith(prefix);
  };
}

/** True when the argument at `key` is a string matching any of the globs. */
export function argGlob(key: string, ...patterns: string[]): PolicyCondition {
  return (context) => {
    const value = read(context, key);
    return typeof value === "string" && matchAnyGlob(patterns, value);
  };
}

/** True when the argument at `key` is present and not null/empty-string. */
export function argPresent(key: string): PolicyCondition {
  return (context) => {
    const value = read(context, key);
    return value !== undefined && value !== null && value !== "";
  };
}

/** True when the argument at `key` is a number inside `[min, max]` inclusive. */
export function argInRange(key: string, min: number, max: number): PolicyCondition {
  return (context) => {
    const value = read(context, key);
    return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
  };
}

/** True when the caller identity matches any of the globs. */
export function identityIs(...patterns: string[]): PolicyCondition {
  return (context) =>
    typeof context.identity === "string" && matchAnyGlob(patterns, context.identity);
}

/** True when `params._meta[key]` strictly equals any of `values`. */
export function metaEquals(key: string, ...values: unknown[]): PolicyCondition {
  return (context) => values.includes(context.meta?.[key]);
}

/** Logical AND over conditions. With no arguments, true. */
export function and(...conditions: PolicyCondition[]): PolicyCondition {
  return (context) => conditions.every((condition) => condition(context));
}

/** Logical OR over conditions. With no arguments, false. */
export function or(...conditions: PolicyCondition[]): PolicyCondition {
  return (context) => conditions.some((condition) => condition(context));
}

/** Logical NOT. */
export function not(condition: PolicyCondition): PolicyCondition {
  return (context) => !condition(context);
}
