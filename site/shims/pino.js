/**
 * The library only ever calls `debug`/`warn` and assigns `.level`. The demo
 * routes those to the console so `debug: true` is observable in devtools.
 */
function createLogger(options = {}) {
  const logger = {
    level: options.level ?? "silent",
    debug(...args) {
      if (logger.level === "debug") console.debug("[mcp-policy-guard]", ...args);
    },
    warn(...args) {
      if (logger.level !== "silent") console.warn("[mcp-policy-guard]", ...args);
    },
    info(...args) {
      if (logger.level !== "silent") console.info("[mcp-policy-guard]", ...args);
    },
    error(...args) {
      if (logger.level !== "silent") console.error("[mcp-policy-guard]", ...args);
    },
  };
  return logger;
}

export default createLogger;
export { createLogger as pino };
