import { describe, expect, it } from "vitest";
import { businessCaseGuidanceSchema } from "../src/bedrock-client.js";
import { buildMissionRetrievalQuery } from "../src/mcp-client.js";
import { businessCaseWatchMission, evaluateOrionConflict } from "../src/missions/business-case-watch.js";
import { orionActionRequestHash } from "../src/orion-mission.js";

describe("Mission 2 Business Case Watch",()=>{
  it("detects the deterministic cost/schedule conflict",()=>{
    const result=evaluateOrionConflict({standardDelayDays:28,standardProtectsDate:false,acceleratedAdditionalCapex:"310000.00",acceleratedProtectsDate:true});
    expect(result).toMatchObject({conflictDetected:true,standardDelayDays:28,acceleratedAdditionalCapex:"310000.00"});
    expect(businessCaseWatchMission.attentionCondition(result)).toBe(true);
  });
  it("keeps epistemic types distinct",()=>{
    expect(businessCaseWatchMission.memoryScope.longitudinalKinds).toEqual(["FACT","DECISION","OBSERVED_PATTERN","INFERENCE","FOLLOW_UP"]);
  });
  it("validates bounded guidance and uncertainty",()=>{
    expect(businessCaseGuidanceSchema.parse({summary:"A procurement conflict requires executive attention.",recommendedAction:"PRESENT_BOTH_RECOMMEND_ACCELERATED",explanation:"Present both alternatives and distinguish the schedule and cost trade-off.",uncertaintyStatement:"This is a bounded observed pattern, not a confirmed permanent client preference."}).recommendedAction).toBe("PRESENT_BOTH_RECOMMEND_ACCELERATED");
  });
  it("builds governed mission-scoped retrieval",()=>{
    const query=buildMissionRetrievalQuery("00000000-0000-4000-8000-000000000001","business-case-watch-orion",Array.from({length:1024},()=>0.03125));
    expect(query).toContain("mission_id = 'business-case-watch-orion'"); expect(query).toContain("session_id IS NULL"); expect(query.length).toBeLessThan(16384);
  });
  it("binds ORION action receipts to the complete request",()=>{
    const runId="00000000-0000-4000-8000-000000000001";
    expect(orionActionRequestHash(runId,"2026-09-01").equals(orionActionRequestHash(runId,"2026-09-01"))).toBe(true);
    expect(orionActionRequestHash(runId,"2026-09-01").equals(orionActionRequestHash(runId,"2026-09-02"))).toBe(false);
  });
});
