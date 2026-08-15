import { z } from "zod";

const runtimeEnvironmentSchema = z.object({
  AWS_REGION: z.string().min(1).default("us-east-1"),
  MCP_ENDPOINT: z.string().url(),
  MCP_SECRET_ARN: z.string().min(1),
  SQL_SECRET_ARN: z.string().min(1),
  EMBEDDING_MODEL_ID: z.string().min(1).default("amazon.titan-embed-text-v2:0"),
  GUIDANCE_MODEL_ID: z.string().min(1).default("amazon.nova-lite-v1:0"),
});

export type RuntimeEnvironment = z.infer<typeof runtimeEnvironmentSchema>;

export function readRuntimeEnvironment(source: NodeJS.ProcessEnv = process.env): RuntimeEnvironment {
  return runtimeEnvironmentSchema.parse(source);
}
