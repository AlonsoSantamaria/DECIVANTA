import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import type { Context, Handler } from "aws-lambda";
import { embedText, runBedrockContracts } from "./bedrock-client.js";
import { mcpSecretSchema, NORTHSTAR_ORGANIZATION_ID, spikeEventSchema, UPDATED_FORECAST_SIGNAL } from "./contract.js";
import { runManagedMcpRead, runManagedMcpVectorRetrieval } from "./mcp-client.js";
import { createDemoSession, retrievePersistedMissionContext, runDecisionCycle } from "./orchestrator.js";
import { getSessionState, recordExecutiveResponse, resetSession, retryGuidance } from "./commands.js";
import { handleHttpApiRequest, isHttpApiRequest } from "./http-api.js";

const secrets = new SecretsManagerClient({});

function commandFailure(requestId: string, error: unknown) {
  const code = error instanceof Error ? error.message : "COMMAND_FAILED";
  const safeCodes = new Set([
    "COMMAND_ALREADY_PROCESSING", "DEMO_SESSION_INVALID", "IDEMPOTENCY_CONFLICT",
    "NEXT_REVIEW_DATE_INVALID", "NOTE_REQUIRED", "REVIEW_NOT_FOUND",
  ]);
  const status = safeCodes.has(code) ? code : "COMMAND_FAILED";
  const statusCode = code === "DEMO_SESSION_INVALID" ? 401 : code === "REVIEW_NOT_FOUND" ? 404 : code === "IDEMPOTENCY_CONFLICT" ? 409 : 422;
  console.warn(JSON.stringify({ requestId, status }));
  return { statusCode, body: JSON.stringify({ requestId, status }) };
}

const operationHandler: Handler = async (event) => {
  const requestId = crypto.randomUUID();
  const parsedEvent = spikeEventSchema.safeParse(event ?? {});
  if (!parsedEvent.success) {
    return { statusCode: 400, body: JSON.stringify({ requestId, status: "INVALID_REQUEST" }) };
  }

  if (parsedEvent.data.operation === "bedrock-contract") {
    let result;
    try {
      result = await runBedrockContracts();
    } catch {
      console.warn(JSON.stringify({ requestId, status: "BEDROCK_UNAVAILABLE" }));
      return { statusCode: 503, body: JSON.stringify({ requestId, status: "BEDROCK_UNAVAILABLE" }) };
    }
    console.info(JSON.stringify({
      requestId,
      status: result.guidance.status === "GUIDANCE_AVAILABLE" ? "BEDROCK_SUCCESS" : "GUIDANCE_UNAVAILABLE",
      embeddingDimension: result.embedding.dimension,
      embeddingNorm: Number(result.embedding.norm.toFixed(6)),
      embeddingDurationMs: result.embedding.durationMs,
      guidanceDurationMs: result.guidance.durationMs,
      repairAttempts: result.guidance.repairAttempts,
      failureReason: result.guidance.status === "GUIDANCE_UNAVAILABLE" ? result.guidance.failureReason : null,
      failureDetail: result.guidance.status === "GUIDANCE_UNAVAILABLE" ? result.guidance.failureDetail : null,
      recommendation: result.guidance.status === "GUIDANCE_AVAILABLE" ? result.guidance.value.recommendedAction : null,
    }));
    return {
      statusCode: result.guidance.status === "GUIDANCE_AVAILABLE" ? 200 : 503,
      body: JSON.stringify({
        requestId,
        status: result.guidance.status,
        embeddingDimension: result.embedding.dimension,
        embeddingNorm: Number(result.embedding.norm.toFixed(6)),
        embeddingDurationMs: result.embedding.durationMs,
        guidanceDurationMs: result.guidance.durationMs,
        repairAttempts: result.guidance.repairAttempts,
        failureReason: result.guidance.status === "GUIDANCE_UNAVAILABLE" ? result.guidance.failureReason : null,
        failureDetail: result.guidance.status === "GUIDANCE_UNAVAILABLE" ? result.guidance.failureDetail : null,
        recommendation: result.guidance.status === "GUIDANCE_AVAILABLE" ? result.guidance.value.recommendedAction : null,
      }),
    };
  }

  if (parsedEvent.data.operation === "create-session") {
    const result = await createDemoSession();
    console.info(JSON.stringify({ requestId, status: "DEMO_SESSION_CREATED", generation: result.generation }));
    return { statusCode: 201, body: JSON.stringify({ requestId, status: "DEMO_SESSION_CREATED", ...result }) };
  }

  if (parsedEvent.data.operation === "get-state") {
    try {
      const state = await getSessionState(parsedEvent.data.sessionToken);
      return { statusCode: 200, body: JSON.stringify({ requestId, status: "STATE_READY", state }) };
    } catch (error) {
      return commandFailure(requestId, error);
    }
  }

  if (parsedEvent.data.operation === "record-response") {
    try {
      const result = await recordExecutiveResponse(parsedEvent.data);
      console.info(JSON.stringify({ requestId, status: "RESPONSE_RECORDED", replayed: result.replayed }));
      return { statusCode: 200, body: JSON.stringify({ requestId, status: "RESPONSE_RECORDED", ...result }) };
    } catch (error) {
      return commandFailure(requestId, error);
    }
  }

  if (parsedEvent.data.operation === "retry-guidance") {
    try {
      const result = await retryGuidance(parsedEvent.data);
      return { statusCode: 200, body: JSON.stringify({ requestId, ...result }) };
    } catch (error) {
      return commandFailure(requestId, error);
    }
  }

  if (parsedEvent.data.operation === "reset") {
    try {
      const result = await resetSession(parsedEvent.data);
      console.info(JSON.stringify({ requestId, status: "DEMO_RESET", generation: result.generation, replayed: result.replayed }));
      return { statusCode: 200, body: JSON.stringify({ requestId, status: "DEMO_RESET", ...result }) };
    } catch (error) {
      return commandFailure(requestId, error);
    }
  }

  const secretArn = process.env.MCP_SECRET_ARN;
  const endpoint = process.env.MCP_ENDPOINT;
  if (!secretArn || !endpoint) throw new Error("MCP_CONFIGURATION_UNAVAILABLE");

  const secretResponse = await secrets.send(new GetSecretValueCommand({ SecretId: secretArn }));
  const parsedSecret = mcpSecretSchema.parse(JSON.parse(secretResponse.SecretString ?? "{}"));
  if (parsedEvent.data.operation === "run-cycle") {
    const result = await runDecisionCycle(
      endpoint,
      parsedSecret,
      parsedEvent.data.sessionToken,
      parsedEvent.data.idempotencyKey,
    );
    console.info(JSON.stringify({
      requestId,
      status: result.snapshot.status,
      replayed: result.replayed,
      reviewRunId: result.snapshot.reviewRunId,
      timings: result.timings,
    }));
    return { statusCode: 200, body: JSON.stringify({ requestId, ...result }) };
  }
  if (parsedEvent.data.operation === "retrieve-context") {
    const result = await retrievePersistedMissionContext(endpoint, parsedSecret, parsedEvent.data.sessionToken);
    return { statusCode: 200, body: JSON.stringify({ requestId, status: "PERSISTED_CONTEXT_RETRIEVED", ...result }) };
  }
  if (parsedEvent.data.operation === "vector-retrieval") {
    const embedded = await embedText(UPDATED_FORECAST_SIGNAL);
    const result = await runManagedMcpVectorRetrieval(
      endpoint,
      parsedSecret,
      NORTHSTAR_ORGANIZATION_ID,
      embedded.values,
    );
    console.info(JSON.stringify({
      requestId,
      status: "MCP_VECTOR_SUCCESS",
      tool: result.tool,
      embeddingDurationMs: embedded.durationMs,
      retrievalDurationMs: result.durationMs,
      rowCount: result.rowCount,
      matches: result.matches.map((match, index) => ({
        rank: index + 1,
        sourceId: match.source_id,
        sourceType: match.source_type,
        distance: Number(match.cosine_distance.toFixed(6)),
      })),
    }));
    return {
      statusCode: 200,
      body: JSON.stringify({
        requestId,
        status: "MCP_VECTOR_SUCCESS",
        embeddingDurationMs: embedded.durationMs,
        retrievalDurationMs: result.durationMs,
        matches: result.matches.map((match, index) => ({
          rank: index + 1,
          sourceId: match.source_id,
          sourceType: match.source_type,
          distance: Number(match.cosine_distance.toFixed(6)),
        })),
      }),
    };
  }
  const result = await runManagedMcpRead(endpoint, parsedSecret);

  console.info(JSON.stringify({
    requestId,
    status: "MCP_SUCCESS",
    tool: result.tool,
    contentBlocks: result.contentBlocks,
    rowCount: result.rowCount,
    durationMs: result.durationMs,
  }));

  return {
    statusCode: 200,
    body: JSON.stringify({ requestId, status: "MCP_SUCCESS", durationMs: result.durationMs }),
  };
};

export const handler = async (event: unknown, context: Context) => {
  if (isHttpApiRequest(event)) return handleHttpApiRequest(event, operationHandler, context);
  return operationHandler(event, context, () => undefined);
};
