import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { EMBEDDING_MODEL_ID, generateGuidance, GUIDANCE_MODEL_ID, embedText } from "./bedrock-client.js";
import { NORTHSTAR_ORGANIZATION_ID, UPDATED_FORECAST_SIGNAL } from "./contract.js";
import { evaluateGteCondition } from "./domain.js";
import { runManagedMcpVectorRetrieval, type MemoryMatch } from "./mcp-client.js";
import { sqlPool } from "./sql-client.js";
import type { McpSecret } from "./contract.js";

const UPDATED_FORECAST_CODE = "ATLAS-CASH-UPDATED-Q4-2026";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export async function createDemoSession(): Promise<{ sessionToken: string; generation: number }> {
  const token = randomBytes(32).toString("base64url");
  const pool = await sqlPool();
  await pool.query(
    `INSERT INTO demo_sessions (id, token_hash, organization_id, generation, expires_at)
     VALUES ($1::UUID, $2::BYTES, $3::UUID, 1, now() + INTERVAL '24 hours')`,
    [randomUUID(), digest(token), NORTHSTAR_ORGANIZATION_ID],
  );
  return { sessionToken: token, generation: 1 };
}

type CycleSnapshot = {
  conditionMet: boolean;
  decisionCode: string;
  guidanceStatus: "GUIDANCE_AVAILABLE";
  observed: string;
  recommendation: "REQUEST_REVISED_SCENARIO";
  reviewRunId: string;
  shortfall: string;
  status: "COMPLETED";
  threshold: string;
  variance: string;
};

async function beginReview(sessionToken: string, idempotencyKey: string): Promise<
  | { kind: "replay"; snapshot: CycleSnapshot }
  | { kind: "started"; generation: string; reviewRunId: string; sessionId: string }
> {
  const pool = await sqlPool();
  const client = await pool.connect();
  const requestHash = digest(JSON.stringify({ forecastCode: UPDATED_FORECAST_CODE }));
  try {
    await client.query("BEGIN");
    const session = await client.query<{ generation: string; id: string }>(
      `SELECT id, generation::STRING AS generation FROM demo_sessions
        WHERE token_hash = $1::BYTES AND expires_at > now() FOR UPDATE`,
      [digest(sessionToken)],
    );
    if (session.rowCount !== 1) throw new Error("DEMO_SESSION_INVALID");
    const { id: sessionId, generation } = session.rows[0];
    const existing = await client.query<{ request_hash: Buffer; response_snapshot: CycleSnapshot | null; status: string }>(
      `SELECT request_hash, response_snapshot, status FROM command_receipts
        WHERE session_id = $1::UUID AND command_type = 'review' AND idempotency_key = $2`,
      [sessionId, idempotencyKey],
    );
    if (existing.rowCount === 1) {
      if (!Buffer.from(existing.rows[0].request_hash).equals(requestHash)) throw new Error("IDEMPOTENCY_CONFLICT");
      if (existing.rows[0].status === "completed" && existing.rows[0].response_snapshot) {
        await client.query("COMMIT");
        return { kind: "replay", snapshot: existing.rows[0].response_snapshot };
      }
      throw new Error("REVIEW_ALREADY_PROCESSING");
    }
    const forecast = await client.query<{ id: string }>(
      `SELECT id FROM forecasts WHERE organization_id = $1::UUID AND forecast_code = $2`,
      [NORTHSTAR_ORGANIZATION_ID, UPDATED_FORECAST_CODE],
    );
    if (forecast.rowCount !== 1) throw new Error("EVIDENCE_UNAVAILABLE");
    const reviewRunId = randomUUID();
    await client.query(
      `INSERT INTO command_receipts
        (id, session_id, generation, command_type, idempotency_key, request_hash, status)
       VALUES ($1::UUID, $2::UUID, $3::INT8, 'review', $4, $5::BYTES, 'processing')`,
      [randomUUID(), sessionId, generation, idempotencyKey, requestHash],
    );
    await client.query(
      `INSERT INTO review_runs (id, session_id, generation, idempotency_key, status, forecast_id)
       VALUES ($1::UUID, $2::UUID, $3::INT8, $4, 'PROCESSING', $5::UUID)`,
      [reviewRunId, sessionId, generation, idempotencyKey, forecast.rows[0].id],
    );
    await client.query("COMMIT");
    return { kind: "started", generation, reviewRunId, sessionId };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function hydrateCanonicalFacts(matches: MemoryMatch[]): Promise<{
  assumptionId: string;
  currency: string;
  decisionCode: string;
  decisionId: string;
  observed: string;
  threshold: string;
}> {
  const sourceIds = matches.map((match) => match.source_id);
  const pool = await sqlPool();
  const facts = await pool.query<{
    assumption_id: string; currency: string; decision_code: string; decision_id: string; observed: string; threshold: string;
  }>(
    `SELECT a.id AS assumption_id, a.currency_code AS currency, d.decision_code,
            d.id AS decision_id, f.value::STRING AS observed, a.threshold_value::STRING AS threshold
       FROM decisions d
       JOIN decision_assumptions a ON a.decision_id = d.id
       JOIN forecasts f ON f.organization_id = d.organization_id AND f.forecast_code = $3
      WHERE d.organization_id = $1::UUID
        AND d.id = ANY($2::UUID[]) AND a.id = ANY($2::UUID[])
        AND a.metric_code = f.metric_code AND a.operator = 'GTE' AND a.currency_code = f.currency_code`,
    [NORTHSTAR_ORGANIZATION_ID, sourceIds, UPDATED_FORECAST_CODE],
  );
  if (facts.rowCount !== 1) throw new Error("MEMORY_UNAVAILABLE");
  const row = facts.rows[0];
  return {
    assumptionId: row.assumption_id,
    currency: row.currency,
    decisionCode: row.decision_code,
    decisionId: row.decision_id,
    observed: row.observed,
    threshold: row.threshold,
  };
}

async function persistCompletedReview(
  started: { generation: string; reviewRunId: string; sessionId: string },
  idempotencyKey: string,
  matches: MemoryMatch[],
  facts: Awaited<ReturnType<typeof hydrateCanonicalFacts>>,
  snapshot: CycleSnapshot,
  guidance: Awaited<ReturnType<typeof generateGuidance>> & { status: "GUIDANCE_AVAILABLE" },
): Promise<void> {
  const pool = await sqlPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE review_runs SET status = 'COMPLETED', decision_id = $2::UUID, assumption_id = $3::UUID,
              threshold_value = $4::DECIMAL, observed_value = $5::DECIMAL, variance_value = $6::DECIMAL,
              condition_met = $7, completed_at = now()
        WHERE id = $1::UUID AND session_id = $8::UUID AND generation = $9::INT8`,
      [started.reviewRunId, facts.decisionId, facts.assumptionId, snapshot.threshold, snapshot.observed,
        snapshot.variance, snapshot.conditionMet, started.sessionId, started.generation],
    );
    for (const [index, match] of matches.entries()) {
      await client.query(
        `INSERT INTO review_memory_matches (review_run_id, memory_item_id, rank, distance, retrieved_via)
         VALUES ($1::UUID, $2::UUID, $3::INT8, $4::DECIMAL, 'COCKROACH_CLOUD_MCP_VECTOR')
         ON CONFLICT (review_run_id, memory_item_id) DO NOTHING`,
        [started.reviewRunId, match.id, index + 1, match.cosine_distance.toString()],
      );
    }
    await client.query(
      `INSERT INTO guidance_records
        (id, review_run_id, model_id, prompt_version, summary, recommended_action, explanation, caveats)
       VALUES ($1::UUID, $2::UUID, $3, 'guidance-v1', $4, $5, $6, $7::JSONB)`,
      [randomUUID(), started.reviewRunId, process.env.GUIDANCE_MODEL_ID ?? GUIDANCE_MODEL_ID,
        guidance.value.summary, guidance.value.recommendedAction, guidance.value.explanation,
        JSON.stringify(guidance.value.caveats)],
    );
    const events = [
      ["EVIDENCE_RECEIVED", "evidence", "Updated forecast received", { forecastCode: UPDATED_FORECAST_CODE, observed: snapshot.observed }],
      ["MEMORY_RETRIEVED", "decision", "Relevant decision memory retrieved", { decisionCode: snapshot.decisionCode, method: "COCKROACH_CLOUD_MCP_VECTOR" }],
      ["CONDITION_EVALUATED", "calculation", "Material cash condition evaluated", { threshold: snapshot.threshold, observed: snapshot.observed, variance: snapshot.variance, conditionMet: snapshot.conditionMet }],
      ["GUIDANCE_GENERATED", "guidance", "DECIVANTA guidance generated", { recommendedAction: snapshot.recommendation }],
    ] as const;
    for (const [eventType, sourceType, title, details] of events) {
      await client.query(
        `INSERT INTO memory_events
          (id, organization_id, session_id, generation, review_run_id, event_type, source_type, source_id, title, details, occurred_at)
         VALUES ($1::UUID, $2::UUID, $3::UUID, $4::INT8, $5::UUID, $6, $7, $8::UUID, $9, $10::JSONB, now())`,
        [randomUUID(), NORTHSTAR_ORGANIZATION_ID, started.sessionId, started.generation, started.reviewRunId,
          eventType, sourceType, facts.decisionId, title, JSON.stringify(details)],
      );
    }
    await client.query(
      "UPDATE demo_sessions SET current_review_run_id = $1::UUID, last_seen_at = now() WHERE id = $2::UUID",
      [started.reviewRunId, started.sessionId],
    );
    await client.query(
      `UPDATE command_receipts SET status = 'completed', resource_id = $1::UUID,
              response_snapshot = $2::JSONB, completed_at = now()
        WHERE session_id = $3::UUID AND command_type = 'review' AND idempotency_key = $4`,
      [started.reviewRunId, JSON.stringify(snapshot), started.sessionId, idempotencyKey],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function runDecisionCycle(
  endpoint: string,
  mcpSecret: McpSecret,
  sessionToken: string,
  idempotencyKey: string,
): Promise<{ replayed: boolean; snapshot: CycleSnapshot; timings: Record<string, number> }> {
  const totalStarted = performance.now();
  const receipt = await beginReview(sessionToken, idempotencyKey);
  if (receipt.kind === "replay") {
    return { replayed: true, snapshot: receipt.snapshot, timings: { totalMs: Math.round(performance.now() - totalStarted) } };
  }
  const embedded = await embedText(UPDATED_FORECAST_SIGNAL);
  const retrieved = await runManagedMcpVectorRetrieval(endpoint, mcpSecret, NORTHSTAR_ORGANIZATION_ID, embedded.values);
  const facts = await hydrateCanonicalFacts(retrieved.matches);
  const evaluated = evaluateGteCondition(facts.threshold, facts.observed);
  const guidance = await generateGuidance();
  if (guidance.status !== "GUIDANCE_AVAILABLE") throw new Error("GUIDANCE_UNAVAILABLE");
  const snapshot: CycleSnapshot = {
    conditionMet: evaluated.conditionMet,
    decisionCode: facts.decisionCode,
    guidanceStatus: "GUIDANCE_AVAILABLE",
    observed: evaluated.observed,
    recommendation: guidance.value.recommendedAction,
    reviewRunId: receipt.reviewRunId,
    shortfall: evaluated.shortfall,
    status: "COMPLETED",
    threshold: evaluated.threshold,
    variance: evaluated.variance,
  };
  await persistCompletedReview(receipt, idempotencyKey, retrieved.matches, facts, snapshot, guidance);
  return {
    replayed: false,
    snapshot,
    timings: {
      embeddingMs: embedded.durationMs,
      guidanceMs: guidance.durationMs,
      retrievalMs: retrieved.durationMs,
      totalMs: Math.round(performance.now() - totalStarted),
    },
  };
}
