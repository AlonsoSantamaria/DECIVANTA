import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import pg from "pg";
import { z } from "zod";
import { EMBEDDING_MODEL_ID } from "../src/bedrock-client.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sqlSecretSchema = z.object({ connectionString: z.string().min(30) }).strict();
const embeddingSchema = z.object({ embedding: z.array(z.number().finite()).length(1024) });
const secrets = new SecretsManagerClient({ region: process.env.AWS_REGION ?? "us-east-1" });
const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? "us-east-1" });

function vectorLiteral(values: number[]): string {
  if (values.length !== 1024 || values.some((value) => !Number.isFinite(value))) throw new Error("INVALID_EMBEDDING");
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (Math.abs(norm - 1) > 0.01) throw new Error("EMBEDDING_NOT_NORMALIZED");
  return `[${values.map((value) => value.toString()).join(",")}]`;
}

async function embed(content: string): Promise<string> {
  const response = await bedrock.send(new InvokeModelCommand({
    modelId: EMBEDDING_MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({ inputText: content, dimensions: 1024, normalize: true }),
  }));
  return vectorLiteral(embeddingSchema.parse(JSON.parse(new TextDecoder().decode(response.body))).embedding);
}

async function main(): Promise<void> {
  const secret = await secrets.send(new GetSecretValueCommand({ SecretId: process.env.SQL_SECRET_ID ?? "decivanta/sql" }));
  const { connectionString } = sqlSecretSchema.parse(JSON.parse(secret.SecretString ?? "{}"));
  const client = new pg.Client({ connectionString, application_name: "decivanta-migrate-seed" });
  await client.connect();
  try {
    const identity = await client.query<{ current_user: string; is_admin: boolean }>(
      "SELECT current_user, pg_has_role(current_user, 'admin', 'member') AS is_admin",
    );
    console.info(`SQL_IDENTITY user=${identity.rows[0].current_user} admin=${identity.rows[0].is_admin}`);
    if (process.env.VERIFY_ONLY === "1") {
      const access = await client.query<{ organizations: string; memories: string }>(
        "SELECT (SELECT count(*) FROM organizations) AS organizations, (SELECT count(*) FROM memory_items) AS memories",
      );
      console.info(`APP_SQL_ACCESS=READY organizations=${access.rows[0].organizations} memories=${access.rows[0].memories}`);
      return;
    }
    if (process.env.SEED_ONLY !== "1") {
      console.info("MIGRATION_STAGE=schema");
      if (process.env.MIGRATION_002_ONLY !== "1") {
        await client.query(await readFile(join(root, "migrations", "001_initial_schema.sql"), "utf8"));
      }
      await client.query(await readFile(join(root, "migrations", "002_longitudinal_mission_memory.sql"), "utf8"));
      await client.query(await readFile(join(root, "migrations", "003_business_case_watch.sql"), "utf8"));
      await client.query(await readFile(join(root, "migrations", "004_external_intelligence_watch.sql"), "utf8"));
    }
    console.info("MIGRATION_STAGE=seed");
    await client.query(await readFile(join(root, "seeds", "001_northstar_atlas.sql"), "utf8"));
    await client.query(await readFile(join(root, "seeds", "002_orion.sql"), "utf8"));
    await client.query(await readFile(join(root, "seeds", "003_external_event.sql"), "utf8"));
    const memories = await client.query<{ id: string; content: string }>(
      "SELECT id, content FROM memory_items WHERE organization_id = $1::UUID AND embedding IS NULL ORDER BY id",
      ["00000000-0000-4000-8000-000000000001"],
    );
    for (const memory of memories.rows) {
      await client.query("UPDATE memory_items SET embedding = $1::VECTOR WHERE id = $2::UUID", [await embed(memory.content), memory.id]);
    }

    const counts = await client.query<{ organizations: string; decisions: string; assumptions: string; forecasts: string; memories: string; embedded: string; orion: string }>(`
      SELECT (SELECT count(*) FROM organizations) AS organizations,
             (SELECT count(*) FROM decisions) AS decisions,
             (SELECT count(*) FROM decision_assumptions) AS assumptions,
             (SELECT count(*) FROM forecasts) AS forecasts,
             (SELECT count(*) FROM memory_items) AS memories,
             (SELECT count(*) FROM memory_items WHERE embedding IS NOT NULL) AS embedded,
             (SELECT count(*) FROM memory_items WHERE mission_id = 'business-case-watch-orion') AS orion
    `);
    const invariants = await client.query<{ threshold: string; baseline: string; updated: string; variance: string }>(`
      SELECT a.threshold_value::STRING AS threshold, b.value::STRING AS baseline,
             u.value::STRING AS updated, (u.value - a.threshold_value)::STRING AS variance
      FROM decision_assumptions a JOIN decisions d ON d.id = a.decision_id
      JOIN forecasts b ON b.organization_id = d.organization_id AND b.forecast_code = 'ATLAS-CASH-BASELINE-2026'
      JOIN forecasts u ON u.organization_id = d.organization_id AND u.forecast_code = 'ATLAS-CASH-UPDATED-Q4-2026'
      WHERE d.decision_code = 'BOARD-2026-017'
    `);
    const index = await client.query<{ index_name: string }>("SHOW INDEX FROM memory_items");
    const row = counts.rows[0];
    const values = invariants.rows[0];
    console.info(`COUNTS organizations=${row.organizations} decisions=${row.decisions} assumptions=${row.assumptions} forecasts=${row.forecasts} memories=${row.memories} embedded=${row.embedded} orion=${row.orion}`);
    console.info(`INVARIANTS threshold=${values.threshold} baseline=${values.baseline} updated=${values.updated} variance=${values.variance}`);
    console.info(`VECTOR_INDEX_PRESENT=${index.rows.some((item) => item.index_name === "memory_items_org_embedding_idx")}`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "UNCLASSIFIED";
  const message = error instanceof Error ? error.message.replace(/[\r\n]+/g, " ").slice(0, 240) : "unknown error";
  console.error(`MIGRATE_SEED_FAILED code=${code} message=${message}`);
  process.exitCode = 1;
});
