import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context, Handler } from "aws-lambda";
import { z } from "zod";
import { idempotencyKeySchema, sessionTokenSchema } from "../packages/contracts/src/index.js";

type HttpEvent = Pick<APIGatewayProxyEventV2, "body" | "headers" | "rawPath" | "requestContext">;

const reviewBodySchema = z.object({ idempotencyKey: idempotencyKeySchema }).strict();
const retryBodySchema = z.object({ idempotencyKey: idempotencyKeySchema, reviewRunId: z.string().uuid() }).strict();
const responseBodySchema = z.object({
  action: z.enum(["REQUEST_REVISED_SCENARIO", "CONTINUE_WITH_CONDITIONS", "DISMISS_ALERT"]),
  idempotencyKey: idempotencyKeySchema,
  nextReviewDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(500),
  reviewRunId: z.string().uuid(),
}).strict();
const orionActionBodySchema = z.object({ idempotencyKey: idempotencyKeySchema, runId: z.string().uuid(), nextReviewDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict();

export function isHttpApiRequest(event: unknown): event is APIGatewayProxyEventV2 {
  return typeof event === "object" && event !== null && "requestContext" in event && "rawPath" in event;
}

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: {
      "access-control-allow-headers": "authorization,content-type,idempotency-key",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  };
}

function bodyOf(event: HttpEvent): unknown {
  if (!event.body) return {};
  try { return JSON.parse(event.body); } catch { throw new Error("INVALID_JSON"); }
}

function bearer(event: HttpEvent): string {
  const value = event.headers.authorization ?? event.headers.Authorization;
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(value ?? "");
  if (!match) throw new Error("UNAUTHORIZED");
  return sessionTokenSchema.parse(match[1]);
}

function methodOf(event: APIGatewayProxyEventV2): string {
  return event.requestContext.http.method.toUpperCase();
}

export async function handleHttpApiRequest(
  event: APIGatewayProxyEventV2,
  invoke: Handler,
  context: Context,
): Promise<APIGatewayProxyResultV2> {
  const method = methodOf(event);
  if (method === "OPTIONS") return json(204, {});
  if (method === "GET" && event.rawPath === "/health") {
    return json(200, { status: "ok", service: "decivanta-api" });
  }

  try {
    let command: unknown;
    if (method === "POST" && event.rawPath === "/v1/demo/sessions") {
      command = { operation: "create-session" };
    } else if (method === "GET" && event.rawPath === "/v1/demo/state") {
      command = { operation: "get-state", sessionToken: bearer(event) };
    } else if (method === "POST" && event.rawPath === "/v1/demo/reviews") {
      const body = reviewBodySchema.parse(bodyOf(event));
      command = { operation: "run-cycle", sessionToken: bearer(event), idempotencyKey: body.idempotencyKey };
    } else if (method === "POST" && event.rawPath === "/v1/demo/context-retrievals") {
      command = { operation: "retrieve-context", sessionToken: bearer(event) };
    } else if (method === "POST" && event.rawPath === "/v1/missions/orion/reviews") {
      const body = reviewBodySchema.parse(bodyOf(event));
      command = { operation: "orion-review", sessionToken: bearer(event), idempotencyKey: body.idempotencyKey };
    } else if (method === "POST" && event.rawPath === "/v1/missions/orion/actions") {
      const body = orionActionBodySchema.parse(bodyOf(event));
      command = { operation: "orion-action", sessionToken: bearer(event), ...body };
    } else if (method === "POST" && event.rawPath === "/v1/missions/orion/context-retrievals") {
      command = { operation: "orion-context", sessionToken: bearer(event) };
    } else if (method === "POST" && event.rawPath === "/v1/demo/guidance-retries") {
      const body = retryBodySchema.parse(bodyOf(event));
      command = { operation: "retry-guidance", sessionToken: bearer(event), ...body };
    } else if (method === "POST" && event.rawPath === "/v1/demo/responses") {
      const body = responseBodySchema.parse(bodyOf(event));
      command = { operation: "record-response", sessionToken: bearer(event), ...body };
    } else if (method === "POST" && event.rawPath === "/v1/demo/reset") {
      const body = reviewBodySchema.parse(bodyOf(event));
      command = { operation: "reset", sessionToken: bearer(event), idempotencyKey: body.idempotencyKey };
    } else {
      return json(404, { status: "NOT_FOUND" });
    }

    const result = await invoke(command, context, () => undefined);
    if (!result || typeof result !== "object" || !("statusCode" in result)) return json(500, { status: "INTERNAL_ERROR" });
    const shaped = result as { body?: string; statusCode: number };
    return json(shaped.statusCode, JSON.parse(shaped.body ?? "{}"));
  } catch (error) {
    const status = error instanceof Error && error.message === "UNAUTHORIZED" ? "UNAUTHORIZED" : "INVALID_REQUEST";
    return json(status === "UNAUTHORIZED" ? 401 : 400, { status });
  }
}
