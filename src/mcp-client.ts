import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpSecret } from "./contract.js";
import { SCHEMA_READ_QUERY } from "./contract.js";

export type McpReadResult = {
  contentBlocks: number;
  durationMs: number;
  rowCount: number | null;
  tool: "select_query";
};

function rowsFromValue(value: unknown): number | null {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== "object") return null;
  for (const key of ["rows", "data", "results"]) {
    const candidate = (value as Record<string, unknown>)[key];
    if (Array.isArray(candidate)) return candidate.length;
  }
  return null;
}

export function extractRowCount(response: unknown): number | null {
  if (!response || typeof response !== "object") return null;
  const result = response as Record<string, unknown>;
  const structuredCount = rowsFromValue(result.structuredContent);
  if (structuredCount !== null) return structuredCount;
  if (!Array.isArray(result.content)) return null;
  for (const block of result.content) {
    if (!block || typeof block !== "object" || (block as { type?: unknown }).type !== "text") continue;
    const text = (block as { text?: unknown }).text;
    if (typeof text !== "string") continue;
    try {
      const count = rowsFromValue(JSON.parse(text));
      if (count !== null) return count;
    } catch {
      // Non-JSON text is valid MCP content but does not provide a safe row count.
    }
  }
  return null;
}

export async function runManagedMcpRead(
  endpoint: string,
  secret: McpSecret,
): Promise<McpReadResult> {
  const client = new Client({ name: "decivanta-lambda", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${secret.apiKey}`,
        "mcp-cluster-id": secret.clusterId,
      },
    },
  });
  const startedAt = performance.now();

  try {
    await client.connect(transport);
    const response = await client.callTool({
      name: "select_query",
      arguments: {
        database: "decivanta",
        query: SCHEMA_READ_QUERY,
      },
    });
    if (response.isError) throw new Error("MCP_SELECT_QUERY_FAILED");
    return {
      contentBlocks: Array.isArray(response.content) ? response.content.length : 0,
      durationMs: Math.round(performance.now() - startedAt),
      rowCount: extractRowCount(response),
      tool: "select_query",
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}
