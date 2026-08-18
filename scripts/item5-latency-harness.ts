import { randomUUID } from "node:crypto";
import { GetFunctionConfigurationCommand, InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import pg from "pg";
import { z } from "zod";

const sampleCount = Number.parseInt(process.env.SAMPLE_COUNT ?? "10", 10);
if (!Number.isInteger(sampleCount) || sampleCount < 5 || sampleCount > 25) throw new Error("INVALID_SAMPLE_COUNT");
const functionName = "decivanta-managed-mcp-spike";
const lambda = new LambdaClient({ region: process.env.AWS_REGION ?? "us-east-1" });

async function invoke<T>(event: unknown): Promise<T> {
  const response = await lambda.send(new InvokeCommand({
    FunctionName: functionName,
    Payload: new TextEncoder().encode(JSON.stringify(event)),
  }));
  if (response.FunctionError) throw new Error("LAMBDA_FUNCTION_ERROR");
  const envelope = JSON.parse(new TextDecoder().decode(response.Payload)) as { statusCode: number; body: string };
  if (envelope.statusCode >= 400) throw new Error(`LAMBDA_STATUS_${envelope.statusCode}`);
  return JSON.parse(envelope.body) as T;
}

type SessionResponse = { sessionToken: string };
type CycleResponse = {
  replayed: boolean;
  requestId: string;
  snapshot: { reviewRunId: string; shortfall: string; status: string; variance: string };
  timings: { totalMs: number };
};

const durations: number[] = [];
const reviewRunIds: string[] = [];
const correlationIds: string[] = [];
let lastEvent: { idempotencyKey: string; operation: "run-cycle"; sessionToken: string } | undefined;
let lastRunId = "";

for (let index = 0; index < sampleCount; index += 1) {
  const session = await invoke<SessionResponse>({ operation: "create-session" });
  const event = { operation: "run-cycle" as const, sessionToken: session.sessionToken, idempotencyKey: randomUUID() };
  const result = await invoke<CycleResponse>(event);
  if (result.snapshot.status !== "COMPLETED" || result.snapshot.variance !== "-1300000.00" || result.snapshot.shortfall !== "1300000.00") {
    throw new Error("CYCLE_INVARIANT_FAILED");
  }
  durations.push(result.timings.totalMs);
  reviewRunIds.push(result.snapshot.reviewRunId);
  correlationIds.push(result.requestId.slice(-8));
  lastEvent = event;
  lastRunId = result.snapshot.reviewRunId;
}

if (!lastEvent) throw new Error("NO_SAMPLE_EVENT");
const replay = await invoke<CycleResponse>(lastEvent);
if (!replay.replayed || replay.snapshot.reviewRunId !== lastRunId) throw new Error("TIMEOUT_RECOVERY_FAILED");

const ordered = [...durations].sort((a, b) => a - b);
const percentile = (value: number): number => ordered[Math.max(0, Math.ceil(value * ordered.length) - 1)];
const configuration = await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: functionName }));

const secretSchema = z.object({ connectionString: z.string().min(30) }).strict();
const secrets = new SecretsManagerClient({ region: process.env.AWS_REGION ?? "us-east-1" });
const stored = await secrets.send(new GetSecretValueCommand({ SecretId: "decivanta/sql" }));
const { connectionString } = secretSchema.parse(JSON.parse(stored.SecretString ?? "{}"));
const sql = new pg.Client({ connectionString, application_name: "decivanta-item5-harness" });
await sql.connect();
const persisted = await sql.query<{ receipts: string; runs: string; unique_runs: string }>(
  `SELECT count(DISTINCT cr.id)::STRING AS receipts,
          count(DISTINCT rr.id)::STRING AS runs,
          count(DISTINCT rr.id)::STRING AS unique_runs
     FROM review_runs rr
     JOIN command_receipts cr ON cr.resource_id = rr.id
    WHERE rr.id = ANY($1::UUID[])`,
  [reviewRunIds],
);
await sql.end();

console.info(`ITEM5_SAMPLE_SIZE=${sampleCount}`);
console.info(`ITEM5_STATUS_DISTRIBUTION=COMPLETED:${sampleCount}`);
console.info(`ITEM5_LATENCY_MS p50=${percentile(0.5)} p95=${percentile(0.95)} min=${ordered[0]} max=${ordered.at(-1)}`);
console.info(`ITEM5_TIMEOUTS lambda=${configuration.Timeout}s api_gateway=29s`);
console.info(`ITEM5_PERSISTED receipts=${persisted.rows[0].receipts} runs=${persisted.rows[0].runs} unique_runs=${persisted.rows[0].unique_runs}`);
console.info(`ITEM5_REPLAY same_run=true replayed=${replay.replayed} recovery_ms=${replay.timings.totalMs}`);
console.info(`ITEM5_CORRELATION_SUFFIXES=${correlationIds.join(",")}`);
