import { describe, expect, it } from "vitest";
import { canonicalEvidenceMatches } from "../src/orchestrator.js";
import type { MemoryMatch } from "../src/mcp-client.js";

describe("judge-facing memory evidence", () => {
  it("excludes archival scale fixtures from persisted evidence", () => {
    const decisionId = crypto.randomUUID();
    const assumptionId = crypto.randomUUID();
    const fixtureId = crypto.randomUUID();
    const matches = [
      { id: crypto.randomUUID(), source_id: assumptionId, source_type: "assumption", cosine_distance: 0.1 },
      { id: crypto.randomUUID(), source_id: decisionId, source_type: "decision", cosine_distance: 0.2 },
      { id: crypto.randomUUID(), source_id: fixtureId, source_type: "rationale", cosine_distance: 0.3 },
    ] as MemoryMatch[];
    const evidence = canonicalEvidenceMatches(matches, decisionId, assumptionId);
    expect(evidence).toHaveLength(2);
    expect(evidence.some((item) => item.source_id === fixtureId)).toBe(false);
  });
});
