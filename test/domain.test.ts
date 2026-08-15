import { describe, expect, it } from "vitest";
import { evaluateGteCondition } from "../src/domain.js";

describe("deterministic financial evaluation", () => {
  it("calculates the Atlas shortfall with exact decimal arithmetic", () => {
    expect(evaluateGteCondition("4500000.00", "3200000.00")).toEqual({
      conditionMet: false,
      observed: "3200000.00",
      shortfall: "1300000.00",
      threshold: "4500000.00",
      variance: "-1300000.00",
    });
  });

  it("rejects money without exactly two decimal places", () => {
    expect(() => evaluateGteCondition("4500000", "3200000.00")).toThrow("INVALID_DECIMAL_MONEY");
  });
});
