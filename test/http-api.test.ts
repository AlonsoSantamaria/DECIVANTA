import type { APIGatewayProxyEventV2, Context, Handler } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";
import { handleHttpApiRequest } from "../src/http-api.js";

function event(method: string, rawPath: string, body?: unknown, authorization?: string): APIGatewayProxyEventV2 {
  return {
    version: "2.0", routeKey: "$default", rawPath, rawQueryString: "", cookies: [],
    headers: authorization ? { authorization } : {},
    requestContext: { accountId: "", apiId: "", domainName: "", domainPrefix: "", requestId: "test", routeKey: "$default", stage: "$default", time: "", timeEpoch: 0, http: { method, path: rawPath, protocol: "HTTP/1.1", sourceIp: "127.0.0.1", userAgent: "test" } },
    body: body === undefined ? undefined : JSON.stringify(body), isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

const context = {} as Context;

describe("HTTP API contract", () => {
  it("serves a dependency-free health response", async () => {
    const result = await handleHttpApiRequest(event("GET", "/health"), vi.fn() as Handler, context);
    expect(result).toMatchObject({ statusCode: 200 });
  });

  it("rejects review without a bearer session", async () => {
    const result = await handleHttpApiRequest(event("POST", "/v1/demo/reviews", { idempotencyKey: crypto.randomUUID() }), vi.fn() as Handler, context);
    expect(result).toMatchObject({ statusCode: 401 });
  });

  it("maps the typed review contract without leaking authorization", async () => {
    const invoke = vi.fn(async (command) => ({ statusCode: 200, body: JSON.stringify({ status: "COMPLETED" }) })) as unknown as Handler;
    const token = "A".repeat(43);
    const idempotencyKey = crypto.randomUUID();
    const result = await handleHttpApiRequest(event("POST", "/v1/demo/reviews", { idempotencyKey }, `Bearer ${token}`), invoke, context);
    expect(result).toMatchObject({ statusCode: 200 });
    expect(invoke).toHaveBeenCalledWith({ operation: "run-cycle", sessionToken: token, idempotencyKey }, context, expect.any(Function));
  });

  it("returns a closed public error for malformed JSON", async () => {
    const malformed = event("POST", "/v1/demo/reviews", undefined, `Bearer ${"A".repeat(43)}`);
    malformed.body = "{";
    const result = await handleHttpApiRequest(malformed, vi.fn() as Handler, context);
    expect(result).toMatchObject({ statusCode: 400 });
    expect(JSON.parse(String((result as { body: string }).body))).toEqual({ status: "INVALID_REQUEST" });
  });
});
