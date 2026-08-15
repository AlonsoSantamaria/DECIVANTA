import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import pg from "pg";
import { z } from "zod";
import { embedText } from "../src/bedrock-client.js";
import { NORTHSTAR_ORGANIZATION_ID, UPDATED_FORECAST_SIGNAL } from "../src/contract.js";

const secretSchema = z.object({ connectionString: z.string().min(30) }).strict();
const secrets = new SecretsManagerClient({ region: process.env.AWS_REGION ?? "us-east-1" });
const stored = await secrets.send(new GetSecretValueCommand({ SecretId: "decivanta/sql" }));
const { connectionString } = secretSchema.parse(JSON.parse(stored.SecretString ?? "{}"));
const embedded = await embedText(UPDATED_FORECAST_SIGNAL, new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? "us-east-1" }));
const vector = `[${embedded.values.map((value) => value.toFixed(8)).join(",")}]`;
const client = new pg.Client({ connectionString, application_name: "decivanta-vector-explain" });
await client.connect();
try {
  const result = await client.query<{ info: string }>(
    `EXPLAIN SELECT id, source_type, source_id, embedding <=> '${vector}'::VECTOR AS cosine_distance
       FROM memory_items
      WHERE organization_id = '${NORTHSTAR_ORGANIZATION_ID}'::UUID
      ORDER BY embedding <=> '${vector}'::VECTOR
      LIMIT 5`,
  );
  const lines = result.rows.map((row) => row.info);
  const indexLines = lines.filter((line) => /memory_items_org_embedding_idx|vector search|index/i.test(line));
  console.info(`EXPLAIN_VECTOR_INDEX_PRESENT=${lines.some((line) => line.includes("memory_items_org_embedding_idx"))}`);
  for (const line of indexLines) console.info(`EXPLAIN_EVIDENCE=${line.replace(/\s+/g, " ").trim()}`);
} finally {
  await client.end();
}
