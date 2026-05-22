export const BUILTIN_PATTERNS: Record<string, RegExp> = {
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  phone:
    /(?<![\w])(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}(?![\w])/g,
  creditCard: /(?<![\d])(?:\d[ -]*?){13,19}(?![\d])/g,
};

export type RedactConfig = {
  patterns?: Array<keyof typeof BUILTIN_PATTERNS | string>;
  custom?: RegExp[];
  replacement?: string;
};

function collectRegexes(config: RedactConfig): RegExp[] {
  const names = config.patterns ?? ["email", "phone", "creditCard"];
  const regexes: RegExp[] = [];
  for (const name of names) {
    const builtin = BUILTIN_PATTERNS[name];
    if (builtin) regexes.push(new RegExp(builtin.source, builtin.flags));
  }
  for (const custom of config.custom ?? []) {
    const flags = custom.flags.includes("g") ? custom.flags : `${custom.flags}g`;
    regexes.push(new RegExp(custom.source, flags));
  }
  return regexes;
}

export function redactString(input: string, config: RedactConfig = {}): string {
  const replacement = config.replacement ?? "[REDACTED]";
  let out = input;
  for (const re of collectRegexes(config)) out = out.replace(re, replacement);
  return out;
}

export function redactResult<T>(result: T, config: RedactConfig = {}): T {
  return redactValue(result, config) as T;
}

function redactValue(value: unknown, config: RedactConfig): unknown {
  if (typeof value === "string") return redactString(value, config);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, config));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactValue(v, config);
    }
    return out;
  }
  return value;
}
