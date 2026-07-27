/**
 * Pattern library. Each entry is a global RegExp; matches are replaced by
 * `RedactConfig.replacement`. Add your own with `custom` or by mutating this
 * record before constructing the guard.
 */
export const BUILTIN_PATTERNS: Record<string, RegExp> = {
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  phone: /(?<![\w])(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}(?![\w])/g,
  // Digits with optional single separators; length + Luhn are checked below.
  creditCard: /(?<![\d-])(?:\d[ -]?){12,18}\d(?![\d-])/g,
  ssn: /(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)/g,
  ipv4: /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![\d.])/g,
  jwt: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  awsAccessKeyId: /\b(?:AKIA|ASIA|AIDA|AROA|AGPA|ANPA)[0-9A-Z]{16}\b/g,
  apiKey:
    /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  bearerToken: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}={0,2}/g,
  privateKey:
    /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----/g,
  iban: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}\b/g,
};

/** Patterns applied when `patterns` is omitted — unchanged since v0.1. */
export const DEFAULT_PATTERNS = ["email", "phone", "creditCard"] as const;

/** Every builtin. Select with `patterns: "strict"`. */
export const STRICT_PATTERNS = Object.keys(BUILTIN_PATTERNS);

/**
 * Key globs worth redacting in almost any codebase. Not applied unless you
 * opt in: `redact: { keys: [...DEFAULT_SENSITIVE_KEYS] }`.
 */
export const DEFAULT_SENSITIVE_KEYS = [
  "password",
  "passwd",
  "secret",
  "*_secret",
  "token",
  "*_token",
  "*token",
  "authorization",
  "api_key",
  "apiKey",
  "access_key",
  "accessKey",
  "private_key",
  "privateKey",
  "credit_card",
  "creditCard",
  "ssn",
] as const;

export type RedactPatternSelection =
  | "default"
  | "strict"
  | Array<keyof typeof BUILTIN_PATTERNS | string>;

export type RedactConfig = {
  /** Builtin pattern names, or `"strict"` for all of them. Default: email/phone/creditCard. */
  patterns?: RedactPatternSelection;
  /** Extra regexes. A missing `g` flag is added automatically. */
  custom?: RegExp[];
  /** Object keys (glob) whose values are replaced wholesale, regardless of content. */
  keys?: readonly string[];
  /** Text substituted for a match. Default: `[REDACTED]`. */
  replacement?: string;
  /** Keep the last N characters of each match visible, e.g. card last-4. Default: 0. */
  preserveLast?: number;
  /** Validate credit-card matches with the Luhn checksum before redacting. Default: true. */
  luhn?: boolean;
  /** Redact tool results before returning them to the host. Default: true. */
  results?: boolean;
  /** Redact tool arguments before they reach the tool handler. Default: false. */
  arguments?: boolean;
  /** Redact arguments recorded by the audit sink. Default: true when `audit.includeArgs` is on. */
  auditArgs?: boolean;
  /** Maximum object depth walked. Deeper values pass through untouched. Default: 32. */
  maxDepth?: number;
};

type CompiledPattern = { name: string; regex: RegExp };

function selectNames(patterns: RedactPatternSelection | undefined): string[] {
  if (patterns === undefined || patterns === "default") return [...DEFAULT_PATTERNS];
  if (patterns === "strict") return [...STRICT_PATTERNS];
  return patterns as string[];
}

function collectPatterns(config: RedactConfig): CompiledPattern[] {
  const compiled: CompiledPattern[] = [];
  for (const name of selectNames(config.patterns)) {
    const builtin = BUILTIN_PATTERNS[name];
    // Fresh instance per call: shared /g regexes carry lastIndex across uses.
    if (builtin) compiled.push({ name, regex: new RegExp(builtin.source, builtin.flags) });
  }
  for (const [index, custom] of (config.custom ?? []).entries()) {
    const flags = custom.flags.includes("g") ? custom.flags : `${custom.flags}g`;
    compiled.push({ name: `custom[${index}]`, regex: new RegExp(custom.source, flags) });
  }
  return compiled;
}

/** Luhn checksum, used to keep long non-card digit runs (order ids, timestamps) readable. */
export function luhnValid(digits: string): boolean {
  const clean = digits.replace(/\D/g, "");
  if (clean.length < 13 || clean.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = clean.length - 1; i >= 0; i--) {
    let digit = clean.charCodeAt(i) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function substitute(match: string, config: RedactConfig): string {
  const replacement = config.replacement ?? "[REDACTED]";
  const preserve = config.preserveLast ?? 0;
  if (preserve > 0 && match.length > preserve) {
    return `${replacement}${match.slice(-preserve)}`;
  }
  return replacement;
}

/** Apply every configured pattern to a single string. */
export function redactString(input: string, config: RedactConfig = {}): string {
  let out = input;
  for (const { name, regex } of collectPatterns(config)) {
    out = out.replace(regex, (match) => {
      if (name === "creditCard" && config.luhn !== false && !luhnValid(match)) return match;
      return substitute(match, config);
    });
  }
  return out;
}

/** Walk a tool result (or any JSON-ish value) and redact every string in it. */
export function redactResult<T>(result: T, config: RedactConfig = {}): T {
  return redactValue(result, config, 0, new WeakSet()) as T;
}

/** Alias with intent-revealing name for the arguments direction. */
export function redactArgs<T>(args: T, config: RedactConfig = {}): T {
  return redactResult(args, config);
}

function isPlainContainer(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function keyIsSensitive(key: string, config: RedactConfig): boolean {
  if (!config.keys?.length) return false;
  return config.keys.some((pattern) => matchKey(pattern, key));
}

function matchKey(pattern: string, key: string): boolean {
  if (pattern === key) return true;
  if (!pattern.includes("*")) return pattern.toLowerCase() === key.toLowerCase();
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.+^${}()|[\]\\?/-]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`, "i").test(key);
}

function redactValue(
  value: unknown,
  config: RedactConfig,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  const maxDepth = config.maxDepth ?? 32;
  if (depth > maxDepth) return value;
  if (typeof value === "string") return redactString(value, config);
  if (value === null || typeof value !== "object") return value;

  // Cycles would otherwise recurse forever on a self-referential tool result.
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);

  try {
    if (Array.isArray(value)) {
      return value.map((item) => redactValue(item, config, depth + 1, seen));
    }
    // Dates, Buffers, class instances, Maps: leave structure alone.
    if (!isPlainContainer(value)) return value;

    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = keyIsSensitive(key, config)
        ? (config.replacement ?? "[REDACTED]")
        : redactValue(item, config, depth + 1, seen);
    }
    return out;
  } finally {
    seen.delete(value);
  }
}
