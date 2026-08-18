import { describe, expect, it } from "vitest";
import { financialOversightMission } from "../src/missions/financial-oversight.js";
import { buildSessionContextRetrievalQuery } from "../src/mcp-client.js";

describe("DECIVANTA Mission Contract", () => {
  it("keeps deterministic attention separate from executive authority", () => {
    expect(financialOversightMission.attentionCondition({
      conditionMet: false, observed: "3200000.00", shortfall: "1300000.00",
      threshold: "4500000.00", variance: "-1300000.00",
    })).toBe(true);
    expect(financialOversightMission.expectedExecutiveActions).toContain("REQUEST_REVISED_SCENARIO");
    expect(financialOversightMission.requiresNextReview).toBe(true);
  });

  it("keeps future memory categories explicit", () => {
    expect(financialOversightMission.memoryScope.longitudinalKinds).toEqual(["DECISION", "FOLLOW_UP"]);
    expect(financialOversightMission.memoryScope.longitudinalKinds).not.toContain("INFERENCE");
  });

  it("builds session-scoped application-owned MCP SQL", () => {
    const query = buildSessionContextRetrievalQuery(
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
      "1",
      Array.from({ length: 1024 }, () => 0.03125),
    );
    expect(query).toContain("session_id = '00000000-0000-4000-8000-000000000002'::UUID");
    expect(query).toContain("source_type IN ('executive_decision','follow_up')");
    expect(query.length).toBeLessThan(16_384);
  });

  it("rejects invalid server scope", () => {
    expect(() => buildSessionContextRetrievalQuery("bad", "bad", "1", [])).toThrow("INVALID_CONTEXT_SCOPE");
  });
});
