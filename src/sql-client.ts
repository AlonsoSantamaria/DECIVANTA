import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import pg from "pg";
import { z } from "zod";

const sqlSecretSchema = z.object({ connectionString: z.string().min(30) }).strict();
const secrets = new SecretsManagerClient({});
let pool: pg.Pool | undefined;

export async function sqlPool(): Promise<pg.Pool> {
  if (pool) return pool;
  const secretId = process.env.SQL_SECRET_ARN;
  if (!secretId) throw new Error("SQL_CONFIGURATION_UNAVAILABLE");
  const stored = await secrets.send(new GetSecretValueCommand({ SecretId: secretId }));
  const { connectionString } = sqlSecretSchema.parse(JSON.parse(stored.SecretString ?? "{}"));
  pool = new pg.Pool({ connectionString, max: 3, application_name: "decivanta-orchestrator" });
  return pool;
}
