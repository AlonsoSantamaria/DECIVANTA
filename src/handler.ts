import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import type { Handler } from "aws-lambda";
import { mcpSecretSchema, spikeEventSchema } from "./contract.js";
import { runManagedMcpRead } from "./mcp-client.js";

const secrets = new SecretsManagerClient({});

export const handler: Handler = async (event) => {
  const requestId = crypto.randomUUID();
  const parsedEvent = spikeEventSchema.safeParse(event ?? {});
  if (!parsedEvent.success) {
    return { statusCode: 400, body: JSON.stringify({ requestId, status: "INVALID_REQUEST" }) };
  }

  const secretArn = process.env.MCP_SECRET_ARN;
  const endpoint = process.env.MCP_ENDPOINT;
  if (!secretArn || !endpoint) throw new Error("MCP_CONFIGURATION_UNAVAILABLE");

  const secretResponse = await secrets.send(new GetSecretValueCommand({ SecretId: secretArn }));
  const parsedSecret = mcpSecretSchema.parse(JSON.parse(secretResponse.SecretString ?? "{}"));
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
