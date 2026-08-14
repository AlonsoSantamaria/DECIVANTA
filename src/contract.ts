import { z } from "zod";

export const mcpSecretSchema = z.object({
  apiKey: z.string().min(20),
  clusterId: z.string().uuid(),
});

export const spikeEventSchema = z.object({
  operation: z.literal("schema-read").default("schema-read"),
}).strict();

export type McpSecret = z.infer<typeof mcpSecretSchema>;

// Managed MCP intentionally blocks direct information_schema access. This
// allowlisted probe proves a governed database read without exposing metadata.
export const SCHEMA_READ_QUERY = "SELECT 1 AS mcp_read_probe";
