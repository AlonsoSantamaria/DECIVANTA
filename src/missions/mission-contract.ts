export const memoryKinds = ["FACT", "OBSERVED_PATTERN", "INFERENCE", "DECISION", "FOLLOW_UP"] as const;
export type MemoryKind = typeof memoryKinds[number];

export type MissionContract<Evaluation> = Readonly<{
  id: string;
  type: string;
  requiredInputs: readonly string[];
  memoryScope: Readonly<{ canonicalSourceTypes: readonly string[]; longitudinalKinds: readonly MemoryKind[] }>;
  attentionCondition: (evaluation: Evaluation) => boolean;
  expectedExecutiveActions: readonly string[];
  requiresNextReview: true;
  contextRetrievalText: string;
}>;
