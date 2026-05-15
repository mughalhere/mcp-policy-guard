import pino, { type Logger } from "pino";

let logger: Logger | null = null;

export function getLogger(debug = false): Logger {
  if (!logger) {
    logger = pino({ level: debug ? "debug" : "silent", name: "mcp-policy-guard" });
  }
  return logger;
}

export function resetLogger(): void {
  logger = null;
}
