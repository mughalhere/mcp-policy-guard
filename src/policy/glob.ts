/** Convert a simple glob (only `*` wildcards) to a RegExp. */
export function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

export function matchGlob(pattern: string, value: string): boolean {
  return globToRegExp(pattern).test(value);
}

export function matchAnyGlob(patterns: string[], value: string): boolean {
  return patterns.some((p) => matchGlob(p, value));
}
