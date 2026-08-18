import { describe, expect, it } from "vitest";
import { projectTraceDetails } from "../src/commands.js";

describe("Memory Trace projection", () => {
  it("exposes only event-specific evidence fields", () => {
    expect(projectTraceDetails("CONDITION_EVALUATED", {
      threshold: "4500000.00", observed: "3200000.00", variance: "-1300000.00",
      conditionMet: false, rawPrompt: "forbidden", embedding: "forbidden",
    })).toEqual({ threshold: "4500000.00", observed: "3200000.00", variance: "-1300000.00", conditionMet: false });
  });

  it("fails closed for an unknown event", () => {
    expect(projectTraceDetails("UNKNOWN", { secret: "no" })).toEqual({});
  });
});
