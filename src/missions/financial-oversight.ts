import type { FinancialEvaluation } from "../domain.js";
import type { MissionContract } from "./mission-contract.js";

export const financialOversightMission = Object.freeze({
  id: "financial-oversight-atlas",
  type: "FINANCIAL_OVERSIGHT",
  requiredInputs: ["projected_cash_forecast", "board_cash_threshold"],
  memoryScope: {
    canonicalSourceTypes: ["decision", "rationale", "assumption"],
    longitudinalKinds: ["DECISION", "FOLLOW_UP"],
  },
  attentionCondition: (evaluation) => !evaluation.conditionMet,
  expectedExecutiveActions: ["REQUEST_REVISED_SCENARIO", "CONTINUE_WITH_CONDITIONS", "DISMISS_ALERT"],
  requiresNextReview: true,
  contextRetrievalText: "Project Atlas executive decision and scheduled follow-up after the financial condition review.",
} satisfies MissionContract<FinancialEvaluation>);
