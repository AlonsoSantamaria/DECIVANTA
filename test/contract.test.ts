import { describe, expect, it } from "vitest";
import { NORTHSTAR_ORGANIZATION_ID, SCHEMA_READ_QUERY, spikeEventSchema } from "../src/contract.js";
import { buildVectorRetrievalQuery, extractRowCount } from "../src/mcp-client.js";

describe("Managed MCP spike contract", () => {
  it("accepts only the fixed schema-read operation", () => {
    expect(spikeEventSchema.parse({ operation: "schema-read" })).toEqual({ operation: "schema-read" });
  });

  it("accepts the server-owned vector retrieval operation without arguments", () => {
    expect(spikeEventSchema.parse({ operation: "vector-retrieval" })).toEqual({ operation: "vector-retrieval" });
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

  it("builds vector SQL only from a validated UUID and finite 1024-dimensional embedding", () => {
    const query = buildVectorRetrievalQuery(NORTHSTAR_ORGANIZATION_ID, Array.from({ length: 1024 }, () => 1 / 32));
    expect(query).toContain(`organization_id = '${NORTHSTAR_ORGANIZATION_ID}'::UUID`);
    expect(query).toContain("ORDER BY cosine_distance");
    expect(query).toContain("LIMIT 5");
    expect(query.length).toBeLessThanOrEqual(16_384);
  });

  it.each([
    [NORTHSTAR_ORGANIZATION_ID, Array.from({ length: 1023 }, () => 0)],
    [NORTHSTAR_ORGANIZATION_ID, [...Array.from({ length: 1023 }, () => 0), Number.NaN]],
    ["not-a-uuid", Array.from({ length: 1024 }, () => 0)],
  ])("rejects unsafe vector-query inputs", (organizationId, embedding) => {
    expect(() => buildVectorRetrievalQuery(organizationId, embedding)).toThrow();
  });
});
