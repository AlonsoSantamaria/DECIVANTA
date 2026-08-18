import type { MissionContract } from "./mission-contract.js";

export type OrionEvaluation = {
  conflictDetected: boolean;
  standardDelayDays: number;
  standardProtectsDate: boolean;
  acceleratedAdditionalCapex: string;
  acceleratedProtectsDate: boolean;
};

export const businessCaseWatchMission = Object.freeze({
  id: "business-case-watch-orion",
  type: "BUSINESS_CASE_WATCH",
  requiredInputs: ["authorized_capex", "committed_opening_date", "procurement_alternatives"],
  memoryScope: { canonicalSourceTypes: ["fact", "decision", "observed_pattern"], longitudinalKinds: ["FACT", "DECISION", "OBSERVED_PATTERN", "INFERENCE", "FOLLOW_UP"] },
  attentionCondition: (evaluation) => evaluation.conflictDetected,
  expectedExecutiveActions: ["PRESENT_BOTH_RECOMMEND_ACCELERATED"],
  requiresNextReview: true,
  contextRetrievalText: "ORION Industrial Park executive procurement decision, written CAPEX authorization condition, client review commitment, and next follow-up.",
} satisfies MissionContract<OrionEvaluation>);

export function evaluateOrionConflict(input: Omit<OrionEvaluation, "conflictDetected">): OrionEvaluation {
  return { ...input, conflictDetected: !input.standardProtectsDate && input.acceleratedProtectsDate && input.standardDelayDays > 0 };
}
