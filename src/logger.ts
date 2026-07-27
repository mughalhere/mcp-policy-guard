import pino, { type Logger } from "pino";

let logger: Logger | null = null;

export function getLogger(debug = false): Logger {
  if (!logger) {
    logger = pino({ name: "mcp-policy-guard" });
  }
  logger.level = debug ? "debug" : "silent";
  return logger;
}

export function resetLogger(): void {
  logger = null;
}
