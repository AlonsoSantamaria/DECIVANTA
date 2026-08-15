import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import type { Handler } from "aws-lambda";
import { embedText, runBedrockContracts } from "./bedrock-client.js";
import { mcpSecretSchema, NORTHSTAR_ORGANIZATION_ID, spikeEventSchema, UPDATED_FORECAST_SIGNAL } from "./contract.js";
import { runManagedMcpRead, runManagedMcpVectorRetrieval } from "./mcp-client.js";

const secrets = new SecretsManagerClient({});

export const handler: Handler = async (event) => {
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

  const secretArn = process.env.MCP_SECRET_ARN;
  const endpoint = process.env.MCP_ENDPOINT;
  if (!secretArn || !endpoint) throw new Error("MCP_CONFIGURATION_UNAVAILABLE");

  const secretResponse = await secrets.send(new GetSecretValueCommand({ SecretId: secretArn }));
  const parsedSecret = mcpSecretSchema.parse(JSON.parse(secretResponse.SecretString ?? "{}"));
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
