import { describe, expect, it } from "vitest";
import { readRuntimeEnvironment } from "../src/config.js";
import { safeLog } from "../src/safe-log.js";

describe("runtime boundaries", () => {
  it("fails closed when a secret reference is absent", () => {
    expect(() => readRuntimeEnvironment({ MCP_ENDPOINT: "https://example.com" })).toThrow();
  });

  it("redacts forbidden log fields by omission", () => {
    const original = console.info;
    let output = "";
    console.info = (value?: unknown) => { output = String(value); };
    try {
      safeLog("info", { status: "READY", sessionToken: "must-not-appear", embedding: [1, 2] });
    } finally {
      console.info = original;
    }
    expect(output).toContain("READY");
    expect(output).not.toContain("must-not-appear");
    expect(output).not.toContain("embedding");
  });
});
