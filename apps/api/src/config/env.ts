import { z } from "zod";

export const environmentSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]),
  AWS_REGION: z.string().min(1),
  COCKROACH_SECRET_ID: z.string().min(1),
  COCKROACH_MCP_SECRET_ID: z.string().min(1),
  COCKROACH_MCP_URL: z.string().url(),
  BEDROCK_EMBEDDING_MODEL_ID: z.string().min(1),
  BEDROCK_EMBEDDING_DIMENSIONS: z.coerce.number().int().positive(),
  BEDROCK_GUIDANCE_MODEL_ID: z.string().min(1),
  DEMO_ORGANIZATION_SLUG: z.string().min(1),
  DEMO_SESSION_TTL_HOURS: z.coerce.number().int().positive(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]),
});

export type Environment = z.infer<typeof environmentSchema>;

export function readEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  return environmentSchema.parse(source);
}
