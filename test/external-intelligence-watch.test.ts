import { describe, expect, it } from "vitest";
import { externalIntelligenceGuidanceSchema, validateExternalIntelligenceGuidance } from "../src/bedrock-client.js";
import {
  VERIFIED_STEEL_TARIFF_EVENT,
  evaluateExternalEvent,
  externalIntelligenceWatchMission,
} from "../src/missions/external-intelligence-watch.js";

describe("Mission 3 External Intelligence Watch", () => {
  it("keeps acquisition facts separate from intelligence evaluation", () => {
    expect(VERIFIED_STEEL_TARIFF_EVENT.sourcePublisher).toBe("Federal Register");
    expect(VERIFIED_STEEL_TARIFF_EVENT.sourceUrl).toMatch(/^https:\/\/www\.federalregister\.gov\//);
    expect(VERIFIED_STEEL_TARIFF_EVENT.currentRatePercent).toBeGreaterThan(VERIFIED_STEEL_TARIFF_EVENT.priorRatePercent);
  });

  it("requires retrieved business context before raising executive attention", () => {
    const disconnected = evaluateExternalEvent({
      eventType: VERIFIED_STEEL_TARIFF_EVENT.eventType,
      priorRatePercent: VERIFIED_STEEL_TARIFF_EVENT.priorRatePercent,
      currentRatePercent: VERIFIED_STEEL_TARIFF_EVENT.currentRatePercent,
      affectedCategory: VERIFIED_STEEL_TARIFF_EVENT.affectedCategory,
      retrievedBusinessContext: false,
    });
    expect(disconnected).toMatchObject({ relevant: true, connectedToBusinessContext: false, executiveAttentionRequired: false });

    const connected = evaluateExternalEvent({
      eventType: VERIFIED_STEEL_TARIFF_EVENT.eventType,
      priorRatePercent: VERIFIED_STEEL_TARIFF_EVENT.priorRatePercent,
      currentRatePercent: VERIFIED_STEEL_TARIFF_EVENT.currentRatePercent,
      affectedCategory: VERIFIED_STEEL_TARIFF_EVENT.affectedCategory,
      retrievedBusinessContext: true,
    });
    expect(connected).toEqual({ relevant: true, connectedToBusinessContext: true, potentialCostImpact: true, potentialScheduleImpact: true, executiveAttentionRequired: true });
    expect(externalIntelligenceWatchMission.attentionCondition(connected)).toBe(true);
  });

  it("accepts only bounded executive guidance", () => {
    const guidance = externalIntelligenceGuidanceSchema.parse({
      summary: "A verified tariff change is relevant to the active ORION procurement decision.",
      recommendedAction: "REVIEW_ORION_PROCUREMENT_EXPOSURE",
      potentialImpact: "Supplier exposure could affect procurement cost or timing and warrants review.",
      uncertaintyStatement: "Supplier origin, classification, and contractual allocation remain unverified.",
    });
    expect(guidance.recommendedAction).toBe("REVIEW_ORION_PROCUREMENT_EXPOSURE");
  });

  it("allows historical approval facts but rejects autonomous DECIVANTA authority", () => {
    const bounded = {
      summary: "The approved ORION budget may face a relevant external procurement exposure.",
      recommendedAction: "REVIEW_ORION_PROCUREMENT_EXPOSURE" as const,
      potentialImpact: "Covered supplier inputs could affect procurement cost or timing.",
      uncertaintyStatement: "Supplier origin, classification, and contractual allocation remain unverified.",
    };
    expect(validateExternalIntelligenceGuidance(bounded)).toEqual(bounded);
    expect(() => validateExternalIntelligenceGuidance({ ...bounded, summary: "DECIVANTA approved a procurement change for ORION." })).toThrow("GUIDANCE_AUTONOMOUS_AUTHORITY");
  });
});
