import { describe, expect, it } from "vitest";
import { SCHEMA_READ_QUERY, spikeEventSchema } from "../src/contract.js";
import { extractRowCount } from "../src/mcp-client.js";

describe("Managed MCP spike contract", () => {
  it("accepts only the fixed schema-read operation", () => {
    expect(spikeEventSchema.parse({ operation: "schema-read" })).toEqual({ operation: "schema-read" });
  });

  it.each([
    { operation: "schema-read", query: "DROP TABLE decisions" },
    { operation: "schema-read", limit: "1; SELECT pg_sleep(10)" },
    { operation: "schema-read", embedding: [Number.NaN] },
    { operation: "schema-read", embedding: [Number.POSITIVE_INFINITY] },
    { operation: "schema-read", dimension: 1023 },
    { operation: "schema-read", topK: 1e3 },
    { operation: "schema-read", threshold: "0,25" },
  ])("rejects browser-controlled SQL or numeric fields", (event) => {
    expect(spikeEventSchema.safeParse(event).success).toBe(false);
  });

  it("owns the complete SQL template", () => {
    expect(SCHEMA_READ_QUERY).toBe("SELECT 1 AS mcp_read_probe");
    expect(SCHEMA_READ_QUERY).not.toContain("${");
  });

  it("extracts row count without logging returned row data", () => {
    expect(extractRowCount({ content: [{ type: "text", text: '[{"mcp_read_probe":1}]' }] })).toBe(1);
  });
});
