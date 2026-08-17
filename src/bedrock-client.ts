import {
  BedrockRuntimeClient,
  ConverseCommand,
  InvokeModelCommand,
  type ConverseCommandInput,
} from "@aws-sdk/client-bedrock-runtime";
import { z } from "zod";

export const EMBEDDING_MODEL_ID = "amazon.titan-embed-text-v2:0";
export const GUIDANCE_MODEL_ID = "amazon.nova-lite-v1:0";

const embeddingResponseSchema = z.object({
  embedding: z.array(z.number().finite()).length(1024),
});

export async function embedText(
  inputText: string,
  client = new BedrockRuntimeClient({}),
): Promise<{ durationMs: number; values: number[] }> {
  const startedAt = performance.now();
  const response = await client.send(new InvokeModelCommand({
    modelId: process.env.EMBEDDING_MODEL_ID ?? EMBEDDING_MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({ inputText, dimensions: 1024, normalize: true }),
  }));
  const values = embeddingResponseSchema.parse(
    JSON.parse(new TextDecoder().decode(response.body)),
  ).embedding;
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (Math.abs(norm - 1) > 0.01) throw new Error("EMBEDDING_NOT_NORMALIZED");
  return { durationMs: Math.round(performance.now() - startedAt), values };
}

export const guidanceSchema = z.object({
  summary: z.string().min(20).max(320),
  recommendedAction: z.literal("REQUEST_REVISED_SCENARIO"),
  explanation: z.string().min(20).max(320),
  caveats: z.array(z.string().min(5).max(180)).min(1).max(3),
}).strict();

export type Guidance = z.infer<typeof guidanceSchema>;

const AUTONOMOUS_AUTHORITY = /\b(cancel(?:led)?|paus(?:e|ed)|reject(?:ed)?|approv(?:e|ed)|authoriz(?:e|ed)|decid(?:e|ed))\b/i;
const DECIVANTA_AUTONOMOUS_AUTHORITY = /\bDECIVANTA\b.{0,80}\b(cancel(?:led)?|paus(?:e|ed)|reject(?:ed)?|approv(?:e|ed)|authoriz(?:e|ed)|decid(?:e|ed))\b/i;
const NUMERIC_CLAIM = /\d/;

export function validateGuidance(value: unknown): Guidance {
  const guidance = guidanceSchema.parse(value);
  const prose = [guidance.summary, guidance.explanation, ...guidance.caveats].join(" ");
  if (NUMERIC_CLAIM.test(prose)) throw new Error("GUIDANCE_UNSUPPORTED_NUMBER");
  if (AUTONOMOUS_AUTHORITY.test(prose)) throw new Error("GUIDANCE_AUTONOMOUS_AUTHORITY");
  return guidance;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(trimmed);
}

function textFromConverse(output: unknown): string {
  const response = output as { output?: { message?: { content?: Array<{ text?: string }> } } };
  const text = response.output?.message?.content?.find((block) => typeof block.text === "string")?.text;
  if (!text) throw new Error("GUIDANCE_EMPTY_RESPONSE");
  return text;
}

const SYSTEM_PROMPT = [
  "Return JSON only with keys summary, recommendedAction, explanation, and caveats.",
  "recommendedAction must be REQUEST_REVISED_SCENARIO.",
  "caveats must be a JSON array containing one to three strings, never a single string.",
  'Use this exact shape: {"summary":"The financial condition supporting acceleration is no longer satisfied.","recommendedAction":"REQUEST_REVISED_SCENARIO","explanation":"Request a revised financial and operational scenario before Board resubmission.","caveats":["The CEO retains decision authority."]}',
  "Explain that the financial condition supporting acceleration is no longer satisfied.",
  "Recommend a revised financial and operational scenario before Board resubmission.",
  "Do not include digits or monetary values in prose.",
  "Do not claim DECIVANTA cancelled, paused, rejected, approved, authorized, or decided anything.",
  "Do not introduce facts beyond the supplied synthetic facts.",
].join(" ");

const FACTS = [
  "Synthetic company: Northstar Manufacturing.",
  "Project: Atlas.",
  "The Board decision allowed acceleration only if projected cash remained at or above USD 4.5 million.",
  "The updated forecast is USD 3.2 million, deterministically USD 1.3 million below the threshold.",
  "The condition is not met. The CEO retains decision authority.",
].join(" ");

export type BedrockContractResult = {
  embedding: { dimension: 1024; durationMs: number; norm: number };
  guidance:
    | { status: "GUIDANCE_AVAILABLE"; durationMs: number; repairAttempts: 0 | 1; value: Guidance }
    | { status: "GUIDANCE_UNAVAILABLE"; durationMs: number; failureDetail: string; failureReason: GuidanceFailureReason; repairAttempts: 1 };
};

export type GuidanceFailureReason = "JSON_PARSE" | "POLICY_GUARD" | "PROVIDER_CONTRACT" | "SCHEMA_VALIDATION" | "UNKNOWN";

function classifyGuidanceFailure(error: unknown): GuidanceFailureReason {
  if (error instanceof SyntaxError) return "JSON_PARSE";
  if (error instanceof z.ZodError) return "SCHEMA_VALIDATION";
  if (error instanceof Error && error.message.startsWith("GUIDANCE_")) return "POLICY_GUARD";
  if (error instanceof Error && (error.name.includes("Validation") || /output|schema|support/i.test(error.message))) return "PROVIDER_CONTRACT";
  return "UNKNOWN";
}

export async function generateGuidance(client = new BedrockRuntimeClient({})): Promise<BedrockContractResult["guidance"]> {
  const guidanceStarted = performance.now();
  let repairAttempts: 0 | 1 = 0;
  let failureReason: GuidanceFailureReason = "UNKNOWN";
  let failureDetail = "unknown";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const input: ConverseCommandInput = {
      modelId: process.env.GUIDANCE_MODEL_ID ?? GUIDANCE_MODEL_ID,
      system: [{ text: SYSTEM_PROMPT }],
      messages: [{ role: "user", content: [{ text: attempt === 0 ? FACTS : `${FACTS} Previous output failed validation. Follow the JSON contract exactly.` }] }],
      inferenceConfig: { maxTokens: 300, temperature: 0 },
    };
    try {
      const response = await client.send(new ConverseCommand(input));
      const value = validateGuidance(extractJson(textFromConverse(response)));
      return { status: "GUIDANCE_AVAILABLE", durationMs: Math.round(performance.now() - guidanceStarted), repairAttempts, value };
    } catch (error) {
      failureReason = classifyGuidanceFailure(error);
      failureDetail = error instanceof z.ZodError
        ? error.issues.map((issue) => `${issue.path.join(".") || "root"}:${issue.code}`).join(",")
        : error instanceof Error && error.message.startsWith("GUIDANCE_")
          ? error.message
          : failureReason.toLowerCase();
      if (attempt === 0) {
        repairAttempts = 1;
        continue;
      }
    }
  }
  return { status: "GUIDANCE_UNAVAILABLE", durationMs: Math.round(performance.now() - guidanceStarted), failureDetail, failureReason, repairAttempts: 1 };
}

export const businessCaseGuidanceSchema = z.object({
  summary: z.string().min(20).max(360),
  recommendedAction: z.literal("PRESENT_BOTH_RECOMMEND_ACCELERATED"),
  explanation: z.string().min(20).max(420),
  uncertaintyStatement: z.string().min(20).max(300),
}).strict();
export type BusinessCaseGuidance = z.infer<typeof businessCaseGuidanceSchema>;

export async function generateBusinessCaseGuidance(client = new BedrockRuntimeClient({})): Promise<{ durationMs: number; value: BusinessCaseGuidance }> {
  const started = performance.now();
  const system = [
    "Return JSON only with summary, recommendedAction, explanation, uncertaintyStatement.",
    "recommendedAction must be PRESENT_BOTH_RECOMMEND_ACCELERATED.",
    "Explain the cost/schedule conflict and suggest presenting both alternatives.",
    "State that the historical pattern is bounded observation, not a confirmed permanent client preference.",
    "Do not include digits; canonical numeric facts are rendered separately.",
    "Do not claim DECIVANTA made or authorized the decision."
  ].join(" ");
  const facts = "ORION standard procurement protects budget but threatens the committed opening date. Accelerated procurement adds cost and protects that date. Historical fact: a general CAPEX increase was rejected. Historical decision: additional cost was later accepted to protect the opening date.";
  const response = await client.send(new ConverseCommand({ modelId: process.env.GUIDANCE_MODEL_ID ?? GUIDANCE_MODEL_ID, system: [{ text: system }], messages: [{ role: "user", content: [{ text: facts }] }], inferenceConfig: { maxTokens: 350, temperature: 0 } }));
  const value = businessCaseGuidanceSchema.parse(extractJson(textFromConverse(response)));
  const prose = `${value.summary} ${value.explanation} ${value.uncertaintyStatement}`;
  if (NUMERIC_CLAIM.test(prose)) throw new Error("GUIDANCE_UNSUPPORTED_NUMBER");
  if (AUTONOMOUS_AUTHORITY.test(prose)) throw new Error("GUIDANCE_AUTONOMOUS_AUTHORITY");
  if (!/observ|pattern|not a confirmed|not.*preference/i.test(value.uncertaintyStatement)) throw new Error("GUIDANCE_UNCERTAINTY_REQUIRED");
  return { durationMs: Math.round(performance.now() - started), value };
}

export const externalIntelligenceGuidanceSchema = z.object({
  summary: z.string().min(20).max(360),
  recommendedAction: z.literal("REVIEW_ORION_PROCUREMENT_EXPOSURE"),
  potentialImpact: z.string().min(20).max(420),
  uncertaintyStatement: z.string().min(20).max(300),
}).strict();
export type ExternalIntelligenceGuidance = z.infer<typeof externalIntelligenceGuidanceSchema>;

export function validateExternalIntelligenceGuidance(value: unknown): ExternalIntelligenceGuidance {
  const guidance = externalIntelligenceGuidanceSchema.parse(value);
  const prose = `${guidance.summary} ${guidance.potentialImpact} ${guidance.uncertaintyStatement}`;
  if (NUMERIC_CLAIM.test(prose)) throw new Error("GUIDANCE_UNSUPPORTED_NUMBER");
  if (DECIVANTA_AUTONOMOUS_AUTHORITY.test(prose)) throw new Error("GUIDANCE_AUTONOMOUS_AUTHORITY");
  if (!/supplier|origin|classification|contract/i.test(guidance.uncertaintyStatement)) {
    throw new Error("GUIDANCE_UNCERTAINTY_REQUIRED");
  }
  return guidance;
}

export async function generateExternalIntelligenceGuidance(
  client = new BedrockRuntimeClient({}),
): Promise<{ durationMs: number; value: ExternalIntelligenceGuidance }> {
  const started = performance.now();
  const system = [
    "Return JSON only with summary, recommendedAction, potentialImpact, uncertaintyStatement.",
    "recommendedAction must be REVIEW_ORION_PROCUREMENT_EXPOSURE.",
    "Connect the verified steel tariff change to ORION's procurement, capital budget, and committed opening date.",
    "Describe only potential cost and schedule exposure; do not claim a quantified project impact.",
    "State that supplier origin, tariff classification, and contract allocation are not yet verified.",
    "Do not include digits or claim DECIVANTA made or authorized a decision.",
  ].join(" ");
  const facts = [
    "A verified Federal Register event increased the United States tariff on covered steel articles and derivatives.",
    "ORION has an approved capital budget, a committed opening date, and an active procurement trade-off.",
    "Historical memory shows additional cost was accepted only when needed to protect that date.",
    "The actual ORION supplier origin, product classification, and contractual tariff allocation are unknown.",
  ].join(" ");
  const response = await client.send(new ConverseCommand({
    modelId: process.env.GUIDANCE_MODEL_ID ?? GUIDANCE_MODEL_ID,
    system: [{ text: system }],
    messages: [{ role: "user", content: [{ text: facts }] }],
    inferenceConfig: { maxTokens: 350, temperature: 0 },
  }));
  const value = validateExternalIntelligenceGuidance(extractJson(textFromConverse(response)));
  return { durationMs: Math.round(performance.now() - started), value };
}

export async function runBedrockContracts(client = new BedrockRuntimeClient({})): Promise<BedrockContractResult> {
  const embedded = await embedText(
    "Updated cash forecast challenges the condition supporting Project Atlas acceleration.",
    client,
  );
  const norm = Math.sqrt(embedded.values.reduce((sum, value) => sum + value * value, 0));
  return {
    embedding: { dimension: 1024, durationMs: embedded.durationMs, norm },
    guidance: await generateGuidance(client),
  };
}
