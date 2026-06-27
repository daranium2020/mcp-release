import { describe, it, expect, vi } from "vitest";
import { handleCheckRequest } from "../../src/app/api/check/handler.js";
import { createRateLimiter } from "../../src/lib/rate-limit.js";
import { createConcurrencyGuard } from "../../src/lib/concurrency.js";
import type { CheckReport } from "@mcp-launch/core";

// Minimal report that satisfies all required fields
const PASS_REPORT: CheckReport = {
  schemaVersion: "1",
  serverUrl: "https://example.com/mcp",
  checkedAt: "2026-01-01T00:00:00.000Z",
  durationMs: 42,
  overallStatus: "PASS",
  transport: {
    httpStatus: 200,
    httpStatusText: "OK",
    durationMs: 10,
    redirectCount: 0,
    headersAvailable: true,
  },
  protocolVersion: "1.0.0",
  serverInfo: { name: "test-server", version: "1.0.0" },
  findings: [
    { code: "INIT_OK", severity: "PASS", message: "MCP initialization succeeded" },
    { code: "TOOLS_LIST_OK", severity: "PASS", message: "Found 0 tool(s)" },
  ],
  tools: [],
};

const FAIL_REPORT: CheckReport = {
  ...PASS_REPORT,
  overallStatus: "FAIL",
  serverUrl: "https://example.com/mcp",
  findings: [
    { code: "TRANSPORT_ERROR", severity: "FAIL", message: "Connection refused" },
  ],
};

function makeJsonRequest(
  body: unknown,
  opts: { contentType?: string; ip?: string } = {},
): Request {
  return new Request("http://localhost/api/check", {
    method: "POST",
    headers: {
      "Content-Type": opts.contentType ?? "application/json",
      ...(opts.ip ? { "x-forwarded-for": opts.ip } : {}),
    },
    body: JSON.stringify(body),
  });
}

function freshDeps(validator = vi.fn().mockResolvedValue(PASS_REPORT)) {
  return {
    validator,
    rateLimiter: createRateLimiter({ maxPerWindow: 100, windowMs: 60_000 }),
    concurrencyGuard: createConcurrencyGuard({ max: 10 }),
  };
}

describe("POST /api/check — handleCheckRequest", () => {
  // ---- Happy path ----

  it("returns 200 with report for a valid HTTPS request", async () => {
    const deps = freshDeps();
    const req = makeJsonRequest({ endpoint: "https://example.com/mcp" });
    const res = await handleCheckRequest(req, deps);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.report.overallStatus).toBe("PASS");
    expect(body.report.schemaVersion).toBe("1");
  });

  it("passes timeoutMs to the validator when provided", async () => {
    const validator = vi.fn().mockResolvedValue(PASS_REPORT);
    const req = makeJsonRequest({
      endpoint: "https://example.com/mcp",
      timeoutMs: 5000,
    });
    await handleCheckRequest(req, { ...freshDeps(validator) });
    expect(validator).toHaveBeenCalledWith(
      "https://example.com/mcp",
      expect.objectContaining({ timeoutMs: 5000, allowHttp: false }),
    );
  });

  it("returns FAIL report without error when validator resolves to FAIL", async () => {
    const deps = freshDeps(vi.fn().mockResolvedValue(FAIL_REPORT));
    const req = makeJsonRequest({ endpoint: "https://example.com/mcp" });
    const res = await handleCheckRequest(req, deps);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.report.overallStatus).toBe("FAIL");
  });

  it("never invokes tools (allowHttp is always false)", async () => {
    const validator = vi.fn().mockResolvedValue(PASS_REPORT);
    const req = makeJsonRequest({ endpoint: "https://example.com/mcp" });
    await handleCheckRequest(req, { ...freshDeps(validator) });
    expect(validator).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ allowHttp: false }),
    );
  });

  it("sets security headers on success response", async () => {
    const req = makeJsonRequest({ endpoint: "https://example.com/mcp" });
    const res = await handleCheckRequest(req, freshDeps());
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  // ---- Input validation ----

  it("returns 415 for wrong Content-Type", async () => {
    const req = makeJsonRequest(
      { endpoint: "https://example.com/mcp" },
      { contentType: "text/plain" },
    );
    const res = await handleCheckRequest(req, freshDeps());
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("returns 400 for invalid JSON body", async () => {
    const req = new Request("http://localhost/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not valid json",
    });
    const res = await handleCheckRequest(req, freshDeps());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_JSON");
  });

  it("returns 400 for missing endpoint", async () => {
    const req = makeJsonRequest({});
    const res = await handleCheckRequest(req, freshDeps());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("MISSING_ENDPOINT");
  });

  it("returns 400 for unexpected fields", async () => {
    const req = makeJsonRequest({
      endpoint: "https://example.com/mcp",
      adminOverride: true,
    });
    const res = await handleCheckRequest(req, freshDeps());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("UNEXPECTED_FIELD");
  });

  it("returns 400 for embedded credentials in endpoint", async () => {
    const req = makeJsonRequest({
      endpoint: "https://user:pass@example.com/mcp",
    });
    const res = await handleCheckRequest(req, freshDeps());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("EMBEDDED_CREDENTIALS");
  });

  it("returns 400 for HTTP endpoint (non-HTTPS)", async () => {
    const req = makeJsonRequest({ endpoint: "http://example.com/mcp" });
    const res = await handleCheckRequest(req, freshDeps());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("HTTPS_REQUIRED");
  });

  it("returns 400 for invalid URL", async () => {
    const req = makeJsonRequest({ endpoint: "not a url" });
    const res = await handleCheckRequest(req, freshDeps());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_URL");
  });

  it("returns 400 for excessive timeoutMs", async () => {
    const req = makeJsonRequest({
      endpoint: "https://example.com/mcp",
      timeoutMs: 999_999,
    });
    const res = await handleCheckRequest(req, freshDeps());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_TIMEOUT");
  });

  it("returns 400 for timeoutMs below minimum", async () => {
    const req = makeJsonRequest({
      endpoint: "https://example.com/mcp",
      timeoutMs: 100,
    });
    const res = await handleCheckRequest(req, freshDeps());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_TIMEOUT");
  });

  it("returns 413 for oversized body", async () => {
    const bigPayload = { endpoint: "https://example.com/mcp", extra: "x".repeat(5000) };
    const req = new Request("http://localhost/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bigPayload),
    });
    // Body has unexpected field "extra" AND is too large; 413 fires first
    const res = await handleCheckRequest(req, freshDeps());
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toBe("BODY_TOO_LARGE");
  });

  // ---- Abuse controls ----

  it("returns 429 when rate limit is exhausted", async () => {
    const limiter = createRateLimiter({ maxPerWindow: 2, windowMs: 60_000 });
    const guard = createConcurrencyGuard({ max: 10 });
    const validator = vi.fn().mockResolvedValue(PASS_REPORT);
    const deps = { validator, rateLimiter: limiter, concurrencyGuard: guard };

    const makeReq = () =>
      makeJsonRequest({ endpoint: "https://example.com/mcp" }, { ip: "1.2.3.4" });

    await handleCheckRequest(makeReq(), deps);
    await handleCheckRequest(makeReq(), deps);
    const thirdRes = await handleCheckRequest(makeReq(), deps);
    expect(thirdRes.status).toBe(429);
    const body = await thirdRes.json();
    expect(body.error).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("returns 429 when concurrency limit is reached", async () => {
    const limiter = createRateLimiter({ maxPerWindow: 100, windowMs: 60_000 });
    const guard = createConcurrencyGuard({ max: 1 });

    // Hold first slot open (never resolves)
    let releaseFirst!: () => void;
    const firstValidator = vi.fn().mockReturnValue(
      new Promise<CheckReport>((resolve) => {
        releaseFirst = () => resolve(PASS_REPORT);
      }),
    );
    const secondValidator = vi.fn().mockResolvedValue(PASS_REPORT);

    // Fire first request without awaiting
    const firstProm = handleCheckRequest(
      makeJsonRequest({ endpoint: "https://example.com/mcp" }),
      { validator: firstValidator, rateLimiter: limiter, concurrencyGuard: guard },
    );

    // Small tick so first request has time to acquire the slot
    await new Promise((r) => setTimeout(r, 0));

    const secondRes = await handleCheckRequest(
      makeJsonRequest({ endpoint: "https://example.com/mcp" }),
      { validator: secondValidator, rateLimiter: limiter, concurrencyGuard: guard },
    );
    expect(secondRes.status).toBe(429);
    const body = await secondRes.json();
    expect(body.error).toBe("CONCURRENCY_LIMIT_EXCEEDED");

    // Clean up
    releaseFirst();
    await firstProm;
  });

  // ---- Error handling ----

  it("maps validator error to 500 with redacted message", async () => {
    const validator = vi.fn().mockRejectedValue(
      new Error("Connection to https://user:secret@internal.example.com failed"),
    );
    const req = makeJsonRequest({ endpoint: "https://example.com/mcp" });
    const res = await handleCheckRequest(req, {
      ...freshDeps(validator),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("VALIDATOR_ERROR");
    // Credentials must not appear in error message
    expect(body.message).not.toContain("secret");
  });

  it("does not expose stack traces in error responses", async () => {
    const validator = vi.fn().mockRejectedValue(new Error("Something broke"));
    const req = makeJsonRequest({ endpoint: "https://example.com/mcp" });
    const res = await handleCheckRequest(req, {
      ...freshDeps(validator),
    });
    const body = await res.json();
    expect(body).not.toHaveProperty("stack");
    expect(JSON.stringify(body)).not.toContain("at Object.");
    expect(JSON.stringify(body)).not.toContain("at async");
  });
});
