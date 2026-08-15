import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpSecret } from "./contract.js";
import { SCHEMA_READ_QUERY } from "./contract.js";
import { z } from "zod";

export type McpReadResult = {
  contentBlocks: number;
  durationMs: number;
  rowCount: number | null;
  tool: "select_query";
};

const memoryMatchSchema = z.object({
  id: z.string().uuid(),
  source_type: z.enum(["decision", "rationale", "assumption"]),
  source_id: z.string().uuid(),
  cosine_distance: z.coerce.number().finite().min(0).max(2),
});

export type MemoryMatch = z.infer<typeof memoryMatchSchema>;

export type McpVectorResult = McpReadResult & { matches: MemoryMatch[] };

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

function findMemoryRows(value: unknown, depth = 0): unknown[] | null {
  if (depth > 5) return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return value;
    if (value.every((row) => row && typeof row === "object" && "source_type" in row)) return value;
    for (const item of value) {
      const nested = findMemoryRows(item, depth + 1);
      if (nested) return nested;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const item of Object.values(value as Record<string, unknown>)) {
    const nested = findMemoryRows(item, depth + 1);
    if (nested) return nested;
  }
  return null;
}

function extractJsonRows(response: unknown): unknown[] {
  if (!response || typeof response !== "object") throw new Error("MCP_RESPONSE_INVALID");
  const result = response as Record<string, unknown>;
  const structuredRows = findMemoryRows(result.structuredContent);
  if (structuredRows) return structuredRows;
  if (!Array.isArray(result.content)) throw new Error("MCP_RESPONSE_ROWS_UNAVAILABLE");
  for (const block of result.content) {
    if (!block || typeof block !== "object" || (block as { type?: unknown }).type !== "text") continue;
    const value = (block as { text?: unknown }).text;
    if (typeof value !== "string") continue;
    try {
      const rows = findMemoryRows(JSON.parse(value));
      if (rows) return rows;
    } catch {
      // Continue until an MCP text block containing JSON rows is found.
    }
  }
  throw new Error("MCP_RESPONSE_ROWS_UNAVAILABLE");
}

export function buildVectorRetrievalQuery(organizationId: string, embedding: number[]): string {
  if (!z.string().uuid().safeParse(organizationId).success) throw new Error("INVALID_ORGANIZATION_ID");
  if (embedding.length !== 1024 || embedding.some((value) => !Number.isFinite(value))) {
    throw new Error("INVALID_EMBEDDING");
  }
  const vector = `[${embedding.map((value) => value.toFixed(8)).join(",")}]`;
  const query = `SELECT id, source_type, source_id, embedding <=> '${vector}'::VECTOR AS cosine_distance FROM memory_items WHERE organization_id = '${organizationId}'::UUID ORDER BY cosine_distance LIMIT 5`;
  if (query.length > 16_384) throw new Error("MCP_QUERY_TOO_LONG");
  return query;
}

async function callSelectQuery(endpoint: string, secret: McpSecret, query: string): Promise<{ response: unknown; durationMs: number }> {
  const client = new Client({ name: "decivanta-lambda", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { Authorization: `Bearer ${secret.apiKey}`, "mcp-cluster-id": secret.clusterId } },
  });
  const startedAt = performance.now();
  try {
    await client.connect(transport);
    const response = await client.callTool({ name: "select_query", arguments: { database: "decivanta", query } });
    if (response.isError) throw new Error("MCP_SELECT_QUERY_FAILED");
    return { response, durationMs: Math.round(performance.now() - startedAt) };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function runManagedMcpVectorRetrieval(
  endpoint: string,
  secret: McpSecret,
  organizationId: string,
  embedding: number[],
): Promise<McpVectorResult> {
  const { response, durationMs } = await callSelectQuery(
    endpoint,
    secret,
    buildVectorRetrievalQuery(organizationId, embedding),
  );
  const matches = z.array(memoryMatchSchema).max(5).parse(extractJsonRows(response));
  return {
    contentBlocks: Array.isArray((response as { content?: unknown[] }).content) ? (response as { content: unknown[] }).content.length : 0,
    durationMs,
    matches,
    rowCount: matches.length,
    tool: "select_query",
  };
}

export async function runManagedMcpRead(
  endpoint: string,
  secret: McpSecret,
): Promise<McpReadResult> {
  const { response, durationMs } = await callSelectQuery(endpoint, secret, SCHEMA_READ_QUERY);
  return {
    contentBlocks: Array.isArray((response as { content?: unknown[] }).content) ? (response as { content: unknown[] }).content.length : 0,
    durationMs,
    rowCount: extractRowCount(response),
    tool: "select_query",
  };
}
