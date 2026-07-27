import pino, { type Logger } from "pino";

let logger: Logger | null = null;

/**
 * Shared pino instance.
 *
 * The library is silent by default: an MCP server usually speaks JSON-RPC over
 * stdio, so anything the library writes there on its own initiative risks
 * corrupting the transport. Pass `debug: true` to `guard()` to raise the level.
 *
 * Calling with no argument returns the logger at whatever level was last set,
 * which is what internal call sites want — they should never change it.
 */
export function getLogger(debug?: boolean): Logger {
  if (!logger) {
    logger = pino({ name: "mcp-policy-guard", level: "silent" });
  }
  if (typeof debug === "boolean") logger.level = debug ? "debug" : "silent";
  return logger;
}

/** Replace the shared logger, e.g. to route library logs into an app logger. */
export function setLogger(custom: Logger): void {
  logger = custom;
}

export function resetLogger(): void {
  logger = null;
}
