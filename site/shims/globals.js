/**
 * Injected globals. `audit.ts` reads `process.pid` for call ids and writes to
 * `process.stdout`/`stderr` for those sinks; `tokens.ts` uses `Buffer.from`
 * before a constant-time compare.
 */

class Bytes extends Uint8Array {
  toString(encoding) {
    if (encoding === "hex") {
      let out = "";
      for (const byte of this) out += byte.toString(16).padStart(2, "0");
      return out;
    }
    return new TextDecoder().decode(this);
  }
}

export const Buffer = {
  from(input, encoding) {
    if (typeof input === "string") {
      if (encoding === "hex") {
        const bytes = new Bytes(input.length / 2);
        for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(input.substr(i * 2, 2), 16);
        return bytes;
      }
      return new Bytes(new TextEncoder().encode(input));
    }
    return new Bytes(input);
  },
};

export const process = {
  pid: 1,
  env: {},
  stdout: { write: (line) => console.log(line.trimEnd()) },
  stderr: { write: (line) => console.warn(line.trimEnd()) },
};
