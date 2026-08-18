import type { MissionContract } from "./mission-contract.js";

export const VERIFIED_STEEL_TARIFF_EVENT = Object.freeze({
  eventCode: "US-STEEL-TARIFF-2025-50",
  title: "United States steel tariff increased from 25% to 50%",
  sourcePublisher: "Federal Register",
  sourceUrl: "https://www.federalregister.gov/documents/2025/06/09/2025-10524/adjusting-imports-of-aluminum-and-steel-into-the-united-states",
  publishedDate: "2025-06-09",
  effectiveDate: "2025-06-04",
  jurisdiction: "US",
  eventType: "REGULATORY_TARIFF_CHANGE",
  priorRatePercent: 25,
  currentRatePercent: 50,
  affectedCategory: "steel articles and derivative steel articles",
});

export type ExternalIntelligenceEvaluation = {
  relevant: boolean;
  connectedToBusinessContext: boolean;
  potentialCostImpact: boolean;
  potentialScheduleImpact: boolean;
  executiveAttentionRequired: boolean;
};

export const externalIntelligenceWatchMission = Object.freeze({
  id: "external-intelligence-watch-orion",
  type: "EXTERNAL_INTELLIGENCE_WATCH",
  requiredInputs: ["verified_external_event", "source_provenance", "orion_business_context"],
  memoryScope: {
    canonicalSourceTypes: ["fact", "decision", "observed_pattern"],
    longitudinalKinds: ["FACT", "DECISION", "OBSERVED_PATTERN", "INFERENCE", "FOLLOW_UP"],
  },
  attentionCondition: (evaluation) => evaluation.executiveAttentionRequired,
  expectedExecutiveActions: ["REVIEW_ORION_PROCUREMENT_EXPOSURE"],
  requiresNextReview: true,
  contextRetrievalText: "ORION Industrial Park steel procurement, approved capital budget, committed opening date, procurement alternatives, client cost authorization, and schedule protection.",
} satisfies MissionContract<ExternalIntelligenceEvaluation>);

export function evaluateExternalEvent(input: {
  eventType: string;
  priorRatePercent: number;
  currentRatePercent: number;
  affectedCategory: string;
  retrievedBusinessContext: boolean;
}): ExternalIntelligenceEvaluation {
  const tariffIncrease = input.eventType === "REGULATORY_TARIFF_CHANGE"
    && input.affectedCategory.toLowerCase().includes("steel")
    && input.currentRatePercent > input.priorRatePercent;
  const connectedToBusinessContext = tariffIncrease && input.retrievedBusinessContext;
  return {
    relevant: tariffIncrease,
    connectedToBusinessContext,
    potentialCostImpact: connectedToBusinessContext,
    potentialScheduleImpact: connectedToBusinessContext,
    executiveAttentionRequired: connectedToBusinessContext,
  };
}
