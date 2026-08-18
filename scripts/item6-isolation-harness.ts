import { createHash, randomUUID } from "node:crypto";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import pg from "pg";
import { z } from "zod";

const lambda = new LambdaClient({ region: process.env.AWS_REGION ?? "us-east-1" });
const functionName = "decivanta-managed-mcp-spike";

async function invoke(event: unknown): Promise<{ body: Record<string, unknown>; statusCode: number }> {
  const response = await lambda.send(new InvokeCommand({
    FunctionName: functionName,
    Payload: new TextEncoder().encode(JSON.stringify(event)),
  }));
  if (response.FunctionError) throw new Error("LAMBDA_FUNCTION_ERROR");
  const envelope = JSON.parse(new TextDecoder().decode(response.Payload)) as { statusCode: number; body: string };
  return { body: JSON.parse(envelope.body) as Record<string, unknown>, statusCode: envelope.statusCode };
}

async function ok(event: unknown): Promise<Record<string, unknown>> {
  const result = await invoke(event);
  if (result.statusCode >= 400) throw new Error(`UNEXPECTED_STATUS_${result.statusCode}`);
  return result.body;
}

const sessionA = await ok({ operation: "create-session" });
const sessionB = await ok({ operation: "create-session" });
const tokenA = String(sessionA.sessionToken);
const tokenB = String(sessionB.sessionToken);
const reviewKey = randomUUID();
const reviewEvent = { operation: "run-cycle", sessionToken: tokenA, idempotencyKey: reviewKey };
const review = await ok(reviewEvent);
const reviewReplay = await ok(reviewEvent);
const snapshot = review.snapshot as { reviewRunId: string };
if (reviewReplay.replayed !== true || (reviewReplay.snapshot as { reviewRunId: string }).reviewRunId !== snapshot.reviewRunId) {
  throw new Error("REVIEW_REPLAY_FAILED");
}

const stateA = await ok({ operation: "get-state", sessionToken: tokenA });
const stateB = await ok({ operation: "get-state", sessionToken: tokenB });
if ((stateA.state as { currentReviewRunId: string }).currentReviewRunId !== snapshot.reviewRunId) throw new Error("SESSION_A_STATE_FAILED");
if ((stateB.state as { currentReviewRunId: string | null }).currentReviewRunId !== null) throw new Error("CROSS_SESSION_READ_FAILED");

const nextReviewDate = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
const responseKey = randomUUID();
const responseEvent = {
  operation: "record-response", sessionToken: tokenA, idempotencyKey: responseKey,
  reviewRunId: snapshot.reviewRunId, action: "REQUEST_REVISED_SCENARIO",
  note: "Prepare a revised financial and operational scenario.", nextReviewDate,
};
const response = await ok(responseEvent);
const responseReplay = await ok(responseEvent);
if (responseReplay.replayed !== true || responseReplay.responseId !== response.responseId) throw new Error("RESPONSE_REPLAY_FAILED");
const conflict = await invoke({ ...responseEvent, note: "Different payload using the same key." });
if (conflict.statusCode !== 409 || conflict.body.status !== "IDEMPOTENCY_CONFLICT") throw new Error("REQUEST_HASH_CONFLICT_FAILED");

const crossResponse = await invoke({ ...responseEvent, sessionToken: tokenB, idempotencyKey: randomUUID() });
if (crossResponse.statusCode !== 404 || crossResponse.body.status !== "REVIEW_NOT_FOUND") throw new Error("CROSS_SESSION_RESPONSE_FAILED");

const guidanceKey = randomUUID();
const guidanceEvent = { operation: "retry-guidance", sessionToken: tokenA, idempotencyKey: guidanceKey, reviewRunId: snapshot.reviewRunId };
const guidance = await ok(guidanceEvent);
const guidanceReplay = await ok(guidanceEvent);
if (guidanceReplay.replayed !== true || guidance.status !== "GUIDANCE_ALREADY_AVAILABLE") throw new Error("GUIDANCE_REPLAY_FAILED");

const resetBKey = randomUUID();
await ok({ operation: "reset", sessionToken: tokenB, idempotencyKey: resetBKey });
const stateAAfterBReset = await ok({ operation: "get-state", sessionToken: tokenA });
if ((stateAAfterBReset.state as { currentReviewRunId: string }).currentReviewRunId !== snapshot.reviewRunId) throw new Error("CROSS_SESSION_RESET_FAILED");

const resetAKey = randomUUID();
const resetEvent = { operation: "reset", sessionToken: tokenA, idempotencyKey: resetAKey };
const reset = await ok(resetEvent);
const resetReplay = await ok(resetEvent);
if (reset.generation !== 2 || resetReplay.generation !== 2 || resetReplay.replayed !== true) throw new Error("RESET_REPLAY_FAILED");
const stateAReset = await ok({ operation: "get-state", sessionToken: tokenA });
if ((stateAReset.state as { generation: string }).generation !== "2" || (stateAReset.state as { currentReviewRunId: string | null }).currentReviewRunId !== null) {
  throw new Error("RESET_STATE_FAILED");
}

const secretSchema = z.object({ connectionString: z.string().min(30) }).strict();
const secrets = new SecretsManagerClient({ region: process.env.AWS_REGION ?? "us-east-1" });
const stored = await secrets.send(new GetSecretValueCommand({ SecretId: "decivanta/sql" }));
const { connectionString } = secretSchema.parse(JSON.parse(stored.SecretString ?? "{}"));
const sql = new pg.Client({ connectionString, application_name: "decivanta-item6-harness" });
await sql.connect();
const hashA = createHash("sha256").update(tokenA, "utf8").digest();
const counts = await sql.query<{
  events: string; generation: string; receipts: string; responses: string; runs: string; token_hash_bytes: string;
}>(
  `SELECT s.generation::STRING AS generation, octet_length(s.token_hash)::STRING AS token_hash_bytes,
          (SELECT count(*) FROM command_receipts WHERE session_id = s.id)::STRING AS receipts,
          (SELECT count(*) FROM review_runs WHERE session_id = s.id)::STRING AS runs,
          (SELECT count(*) FROM executive_responses er JOIN review_runs rr ON rr.id = er.review_run_id WHERE rr.session_id = s.id)::STRING AS responses,
          (SELECT count(*) FROM memory_events WHERE session_id = s.id)::STRING AS events
     FROM demo_sessions s WHERE token_hash = $1::BYTES`,
  [hashA],
);
await sql.end();

console.info("ITEM6_REVIEW_REPLAY=true");
console.info("ITEM6_RESPONSE_REPLAY=true");
console.info("ITEM6_GUIDANCE_RETRY_REPLAY=true");
console.info("ITEM6_REQUEST_HASH_CONFLICT=409");
console.info("ITEM6_CROSS_SESSION_READ=DENIED");
console.info("ITEM6_CROSS_SESSION_RESPONSE=DENIED");
console.info("ITEM6_CROSS_SESSION_RESET=ISOLATED");
console.info(`ITEM6_RESET generation=${reset.generation} replay_generation=${resetReplay.generation}`);
console.info(`ITEM6_COUNTS receipts=${counts.rows[0].receipts} runs=${counts.rows[0].runs} responses=${counts.rows[0].responses} events=${counts.rows[0].events}`);
console.info(`ITEM6_TOKEN_STORAGE hash_bytes=${counts.rows[0].token_hash_bytes} raw_token_stored=false`);
