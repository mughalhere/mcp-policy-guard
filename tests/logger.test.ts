import { describe, expect, it } from "vitest";
import { getLogger, resetLogger } from "../src/logger.js";

describe("getLogger", () => {
  it("applies the requested debug level even after the singleton is created", () => {
    resetLogger();
    const silent = getLogger(false);
    expect(silent.level).toBe("silent");

    // Same underlying singleton, but a later guard() with debug:true must not
    // be stuck with the first caller's level.
    const debug = getLogger(true);
    expect(debug.level).toBe("debug");
    expect(debug).toBe(silent);

    resetLogger();
  });
});
