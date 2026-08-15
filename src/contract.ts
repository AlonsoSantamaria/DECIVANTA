import { z } from "zod";

export const mcpSecretSchema = z.object({
  apiKey: z.string().min(20),
  clusterId: z.string().uuid(),
});

export const spikeEventSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("schema-read") }).strict(),
  z.object({ operation: z.literal("bedrock-contract") }).strict(),
  z.object({ operation: z.literal("vector-retrieval") }).strict(),
  z.object({ operation: z.literal("create-session") }).strict(),
  z.object({
    operation: z.literal("run-cycle"),
    sessionToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    idempotencyKey: z.string().uuid(),
  }).strict(),
  z.object({ operation: z.literal("get-state"), sessionToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict(),
  z.object({
    operation: z.literal("record-response"),
    sessionToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    idempotencyKey: z.string().uuid(),
    reviewRunId: z.string().uuid(),
    action: z.enum(["REQUEST_REVISED_SCENARIO", "CONTINUE_WITH_CONDITIONS", "DISMISS_ALERT"]),
    note: z.string().max(500),
    nextReviewDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).strict(),
  z.object({
    operation: z.literal("retry-guidance"),
    sessionToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    idempotencyKey: z.string().uuid(),
    reviewRunId: z.string().uuid(),
  }).strict(),
  z.object({
    operation: z.literal("reset"),
    sessionToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    idempotencyKey: z.string().uuid(),
  }).strict(),
]);

export type McpSecret = z.infer<typeof mcpSecretSchema>;

// Managed MCP intentionally blocks direct information_schema access. This
// allowlisted probe proves a governed database read without exposing metadata.
export const SCHEMA_READ_QUERY = "SELECT 1 AS mcp_read_probe";

export const NORTHSTAR_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
export const UPDATED_FORECAST_SIGNAL =
  "Northstar Manufacturing updated Project Atlas cash forecast is below the Board-approved cash condition for acceleration.";
