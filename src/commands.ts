import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { NORTHSTAR_ORGANIZATION_ID } from "./contract.js";
import { sqlPool } from "./sql-client.js";

type CommandType = "response" | "guidance_retry" | "reset";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function requestDigest(value: unknown): Buffer {
  return digest(JSON.stringify(value));
}

async function lockSession(client: PoolClient, token: string): Promise<{ generation: string; id: string }> {
  const result = await client.query<{ generation: string; id: string }>(
    `SELECT id, generation::STRING AS generation FROM demo_sessions
      WHERE token_hash = $1::BYTES AND expires_at > now() FOR UPDATE`,
    [digest(token)],
  );
  if (result.rowCount !== 1) throw new Error("DEMO_SESSION_INVALID");
  return result.rows[0];
}

async function existingReceipt<T>(
  client: PoolClient,
  sessionId: string,
  commandType: CommandType,
  idempotencyKey: string,
  hash: Buffer,
): Promise<T | null> {
  const existing = await client.query<{ request_hash: Buffer; response_snapshot: T | null; status: string }>(
    `SELECT request_hash, response_snapshot, status FROM command_receipts
      WHERE session_id = $1::UUID AND command_type = $2 AND idempotency_key = $3`,
    [sessionId, commandType, idempotencyKey],
  );
  if (existing.rowCount === 0) return null;
  if (!Buffer.from(existing.rows[0].request_hash).equals(hash)) throw new Error("IDEMPOTENCY_CONFLICT");
  if (existing.rows[0].status !== "completed" || !existing.rows[0].response_snapshot) throw new Error("COMMAND_ALREADY_PROCESSING");
  return existing.rows[0].response_snapshot;
}

async function insertReceipt(
  client: PoolClient,
  sessionId: string,
  generation: string,
  commandType: CommandType,
  idempotencyKey: string,
  hash: Buffer,
): Promise<void> {
  await client.query(
    `INSERT INTO command_receipts
      (id, session_id, generation, command_type, idempotency_key, request_hash, status)
     VALUES ($1::UUID, $2::UUID, $3::INT8, $4, $5, $6::BYTES, 'processing')`,
    [randomUUID(), sessionId, generation, commandType, idempotencyKey, hash],
  );
}

async function finishReceipt(
  client: PoolClient,
  sessionId: string,
  commandType: CommandType,
  idempotencyKey: string,
  resourceId: string | null,
  snapshot: unknown,
): Promise<void> {
  await client.query(
    `UPDATE command_receipts SET status = 'completed', resource_id = $4::UUID,
            response_snapshot = $5::JSONB, completed_at = now()
      WHERE session_id = $1::UUID AND command_type = $2 AND idempotency_key = $3`,
    [sessionId, commandType, idempotencyKey, resourceId, JSON.stringify(snapshot)],
  );
}

export type MemoryTraceEvent = {
  eventType: string;
  occurredAt: string;
  sourceType: string;
  title: string;
  details: Record<string, boolean | string>;
};

const traceDetailAllowlist: Record<string, readonly string[]> = {
  EVIDENCE_RECEIVED: ["forecastCode", "observed"],
  MEMORY_RETRIEVED: ["decisionCode", "method"],
  CONDITION_EVALUATED: ["threshold", "observed", "variance", "conditionMet"],
  GUIDANCE_GENERATED: ["recommendedAction"],
  GUIDANCE_UNAVAILABLE: ["status"],
  EXECUTIVE_RESPONSE_RECORDED: ["action"],
  FOLLOW_UP_SCHEDULED: ["nextReviewDate"],
};

export function projectTraceDetails(eventType: string, details: Record<string, unknown>): Record<string, boolean | string> {
  const allowed = traceDetailAllowlist[eventType] ?? [];
  return Object.fromEntries(Object.entries(details).filter(([key, value]) =>
    allowed.includes(key) && (typeof value === "string" || typeof value === "boolean"),
  )) as Record<string, boolean | string>;
}

export async function getSessionState(token: string): Promise<{
  generation: string;
  currentReviewRunId: string | null;
  responseAction: string | null;
  review: null | {
    conditionMet: boolean;
    decisionCode: string;
    guidance: null | { explanation: string; recommendedAction: string; summary: string };
    memoryMatches: Array<{ distance: string; rank: string; sourceType: string }>;
    observed: string;
    status: string;
    threshold: string;
    trace: MemoryTraceEvent[];
    variance: string;
  };
}> {
  const pool = await sqlPool();
  const state = await pool.query<{ current_review_run_id: string | null; generation: string; response_action: string | null }>(
    `SELECT s.generation::STRING AS generation, s.current_review_run_id,
            r.action AS response_action
       FROM demo_sessions s
       LEFT JOIN review_runs rr ON rr.id = s.current_review_run_id
         AND rr.session_id = s.id AND rr.generation = s.generation
       LEFT JOIN executive_responses r ON r.review_run_id = rr.id
      WHERE s.token_hash = $1::BYTES AND s.expires_at > now()`,
    [digest(token)],
  );
  if (state.rowCount !== 1) throw new Error("DEMO_SESSION_INVALID");
  const base = {
    generation: state.rows[0].generation,
    currentReviewRunId: state.rows[0].current_review_run_id,
    responseAction: state.rows[0].response_action,
  };
  if (!base.currentReviewRunId) return { ...base, review: null };

  const review = await pool.query<{
    condition_met: boolean; decision_code: string; explanation: string | null; observed: string;
    recommended_action: string | null; status: string; summary: string | null; threshold: string; variance: string;
  }>(
    `SELECT rr.status, d.decision_code, rr.threshold_value::STRING AS threshold,
            rr.observed_value::STRING AS observed, rr.variance_value::STRING AS variance,
            rr.condition_met, g.summary, g.recommended_action, g.explanation
       FROM review_runs rr
       JOIN demo_sessions s ON s.id = rr.session_id AND s.generation = rr.generation
       JOIN decisions d ON d.id = rr.decision_id
       LEFT JOIN guidance_records g ON g.review_run_id = rr.id
      WHERE rr.id = $1::UUID AND s.token_hash = $2::BYTES`,
    [base.currentReviewRunId, digest(token)],
  );
  if (review.rowCount !== 1) throw new Error("REVIEW_NOT_FOUND");
  const matches = await pool.query<{ distance: string; rank: string; source_type: string }>(
    `SELECT rm.rank::STRING AS rank, rm.distance::STRING AS distance, mi.source_type
       FROM review_memory_matches rm
       JOIN memory_items mi ON mi.id = rm.memory_item_id
       JOIN review_runs rr ON rr.id = rm.review_run_id
      WHERE rm.review_run_id = $1::UUID
        AND (mi.source_id = rr.decision_id OR mi.source_id = rr.assumption_id)
      ORDER BY rm.rank`,
    [base.currentReviewRunId],
  );
  const events = await pool.query<{ details: Record<string, unknown>; event_type: string; occurred_at: Date; source_type: string; title: string }>(
    `SELECT event_type, source_type, title, details, occurred_at
       FROM memory_events WHERE review_run_id = $1::UUID ORDER BY occurred_at, id`,
    [base.currentReviewRunId],
  );
  const row = review.rows[0];
  return {
    ...base,
    review: {
      conditionMet: row.condition_met,
      decisionCode: row.decision_code,
      guidance: row.summary && row.recommended_action && row.explanation ? {
        explanation: row.explanation,
        recommendedAction: row.recommended_action,
        summary: row.summary,
      } : null,
      memoryMatches: matches.rows.map((match) => ({ distance: match.distance, rank: match.rank, sourceType: match.source_type })),
      observed: row.observed,
      status: row.status,
      threshold: row.threshold,
      trace: events.rows.map((item) => ({
        details: projectTraceDetails(item.event_type, item.details),
        eventType: item.event_type,
        occurredAt: item.occurred_at.toISOString(),
        sourceType: item.source_type,
        title: item.title,
      })),
      variance: row.variance,
    },
  };
}

export async function recordExecutiveResponse(input: {
  action: "REQUEST_REVISED_SCENARIO" | "CONTINUE_WITH_CONDITIONS" | "DISMISS_ALERT";
  idempotencyKey: string;
  nextReviewDate: string;
  note: string;
  reviewRunId: string;
  sessionToken: string;
}): Promise<{ action: string; nextReviewDate: string; replayed: boolean; responseId: string }> {
  if (input.nextReviewDate <= new Date().toISOString().slice(0, 10)) throw new Error("NEXT_REVIEW_DATE_INVALID");
  if (input.action !== "REQUEST_REVISED_SCENARIO" && input.note.trim().length === 0) throw new Error("NOTE_REQUIRED");
  const hash = requestDigest({ action: input.action, nextReviewDate: input.nextReviewDate, note: input.note, reviewRunId: input.reviewRunId });
  const pool = await sqlPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const session = await lockSession(client, input.sessionToken);
    const replay = await existingReceipt<Omit<Awaited<ReturnType<typeof recordExecutiveResponse>>, "replayed">>(
      client, session.id, "response", input.idempotencyKey, hash,
    );
    if (replay) {
      await client.query("COMMIT");
      return { ...replay, replayed: true };
    }
    const owned = await client.query(
      `SELECT 1 FROM review_runs WHERE id = $1::UUID AND session_id = $2::UUID
        AND generation = $3::INT8 AND status = 'COMPLETED'`,
      [input.reviewRunId, session.id, session.generation],
    );
    if (owned.rowCount !== 1) throw new Error("REVIEW_NOT_FOUND");
    await insertReceipt(client, session.id, session.generation, "response", input.idempotencyKey, hash);
    const responseId = randomUUID();
    await client.query(
      `INSERT INTO executive_responses
        (id, review_run_id, action, note, executive_name, next_review_date)
       VALUES ($1::UUID, $2::UUID, $3, $4, 'Elena Brooks', $5::DATE)`,
      [responseId, input.reviewRunId, input.action, input.note.trim(), input.nextReviewDate],
    );
    const events = [
      ["EXECUTIVE_RESPONSE_RECORDED", "executive", "Executive response recorded", { action: input.action }],
      ["FOLLOW_UP_SCHEDULED", "follow-up", "Follow-up scheduled", { nextReviewDate: input.nextReviewDate }],
    ] as const;
    for (const [eventType, sourceType, title, details] of events) {
      await client.query(
        `INSERT INTO memory_events
          (id, organization_id, session_id, generation, review_run_id, event_type, source_type, source_id, title, details, occurred_at)
         VALUES ($1::UUID, $2::UUID, $3::UUID, $4::INT8, $5::UUID, $6, $7, $8::UUID, $9, $10::JSONB, now())`,
        [randomUUID(), NORTHSTAR_ORGANIZATION_ID, session.id, session.generation, input.reviewRunId,
          eventType, sourceType, responseId, title, JSON.stringify(details)],
      );
    }
    const snapshot = { action: input.action, nextReviewDate: input.nextReviewDate, responseId };
    await finishReceipt(client, session.id, "response", input.idempotencyKey, responseId, snapshot);
    await client.query("COMMIT");
    return { ...snapshot, replayed: false };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function retryGuidance(input: { idempotencyKey: string; reviewRunId: string; sessionToken: string }): Promise<{
  replayed: boolean; reviewRunId: string; status: "GUIDANCE_ALREADY_AVAILABLE";
}> {
  const hash = requestDigest({ reviewRunId: input.reviewRunId });
  const pool = await sqlPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const session = await lockSession(client, input.sessionToken);
    const replay = await existingReceipt<{ reviewRunId: string; status: "GUIDANCE_ALREADY_AVAILABLE" }>(
      client, session.id, "guidance_retry", input.idempotencyKey, hash,
    );
    if (replay) {
      await client.query("COMMIT");
      return { ...replay, replayed: true };
    }
    const owned = await client.query(
      `SELECT 1 FROM review_runs rr JOIN guidance_records g ON g.review_run_id = rr.id
        WHERE rr.id = $1::UUID AND rr.session_id = $2::UUID AND rr.generation = $3::INT8`,
      [input.reviewRunId, session.id, session.generation],
    );
    if (owned.rowCount !== 1) throw new Error("REVIEW_NOT_FOUND");
    await insertReceipt(client, session.id, session.generation, "guidance_retry", input.idempotencyKey, hash);
    const snapshot = { reviewRunId: input.reviewRunId, status: "GUIDANCE_ALREADY_AVAILABLE" as const };
    await finishReceipt(client, session.id, "guidance_retry", input.idempotencyKey, input.reviewRunId, snapshot);
    await client.query("COMMIT");
    return { ...snapshot, replayed: false };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function resetSession(input: { idempotencyKey: string; sessionToken: string }): Promise<{
  generation: number; replayed: boolean;
}> {
  const hash = requestDigest({ reset: true });
  const pool = await sqlPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const session = await lockSession(client, input.sessionToken);
    const replay = await existingReceipt<{ generation: number }>(client, session.id, "reset", input.idempotencyKey, hash);
    if (replay) {
      await client.query("COMMIT");
      return { ...replay, replayed: true };
    }
    await insertReceipt(client, session.id, session.generation, "reset", input.idempotencyKey, hash);
    const generation = Number(session.generation) + 1;
    await client.query(
      "UPDATE demo_sessions SET generation = $1::INT8, current_review_run_id = NULL, last_seen_at = now() WHERE id = $2::UUID",
      [generation, session.id],
    );
    const snapshot = { generation };
    await finishReceipt(client, session.id, "reset", input.idempotencyKey, null, snapshot);
    await client.query("COMMIT");
    return { generation, replayed: false };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
