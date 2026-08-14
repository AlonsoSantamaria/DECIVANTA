import { describe, expect, it } from "vitest";
import { extractRowCount } from "../src/mcp-client.js";
import type { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { guidanceSchema, runBedrockContracts, validateGuidance } from "../src/bedrock-client.js";

const validGuidance = {
  summary: "The financial condition supporting acceleration is no longer satisfied.",
  recommendedAction: "REQUEST_REVISED_SCENARIO",
  explanation: "Request a revised financial and operational scenario before Board resubmission.",
  caveats: ["The CEO retains authority and should review operational implications."],
};

describe("Bedrock guidance guard", () => {
  it("accepts the approved recommendation contract", () => {
    expect(validateGuidance(validGuidance).recommendedAction).toBe("REQUEST_REVISED_SCENARIO");
  });

  it("rejects an unsupported recommendation enum", () => {
    expect(() => guidanceSchema.parse({ ...validGuidance, recommendedAction: "APPROVE_PROJECT" })).toThrow();
  });

  it("rejects generated numerical claims", () => {
    expect(() => validateGuidance({ ...validGuidance, summary: "Cash is short by 1.3 million." })).toThrow("GUIDANCE_UNSUPPORTED_NUMBER");
  });

  it.each(["DECIVANTA cancelled the project.", "DECIVANTA approved acceleration.", "DECIVANTA paused Atlas."])(
    "rejects autonomous authority language: %s",
    (summary) => expect(() => validateGuidance({ ...validGuidance, summary })).toThrow("GUIDANCE_AUTONOMOUS_AUTHORITY"),
  );

  it("keeps unrelated MCP row-count parsing safe", () => {
    expect(extractRowCount(null)).toBeNull();
  });

  it("makes exactly one repair attempt before returning unavailable", async () => {
    let calls = 0;
    const embedding = Array.from({ length: 1024 }, () => 1 / 32);
    const client = {
      send: async () => {
        calls += 1;
        if (calls === 1) return { body: new TextEncoder().encode(JSON.stringify({ embedding })) };
        return { output: { message: { content: [{ text: "not-json" }] } } };
      },
    } as unknown as BedrockRuntimeClient;

    const result = await runBedrockContracts(client);
    expect(calls).toBe(3);
    expect(result.guidance).toMatchObject({ status: "GUIDANCE_UNAVAILABLE", repairAttempts: 1 });
  });
});
