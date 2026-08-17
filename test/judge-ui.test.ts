import { describe,expect,it } from "vitest";
import { canRecordExecutiveAction,executiveSequence,mergeEvidenceKinds } from "../apps/web/app/judge-view-model.js";

describe("Judge UI executive view model",()=>{
  it("preserves the approved executive sequence",()=>{
    expect(executiveSequence).toEqual(["Attention","Context","Evidence & Memory Trace","Potential Impact","Recommendation","Executive Action","Follow-up"]);
  });
  it("deduplicates epistemic evidence without hiding its type",()=>{
    expect(mergeEvidenceKinds(["FACT","DECISION"],["OBSERVED_PATTERN","FACT"])).toEqual(["DECISION","FACT","OBSERVED_PATTERN"]);
  });
  it("fails closed when typed guidance is unavailable",()=>{
    expect(canRecordExecutiveAction("GUIDANCE_AVAILABLE")).toBe(true);
    expect(canRecordExecutiveAction("GUIDANCE_UNAVAILABLE")).toBe(false);
  });
});
