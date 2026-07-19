/**
 * Tests for v0.3.0 auth finding codes:
 *
 *   AUTH_REQUIRED  — 401 without credentials (WARNING)
 *   AUTH_INVALID   — 401 with credentials, including RFC 6750 error="invalid_token" (FAIL)
 *   AUTH_EXPIRED   — 401 with credentials + unambiguous expiry code: error="expired" or
 *                    error="token_expired" (FAIL)
 *   AUTH_FORBIDDEN — 403 (FAIL)
 *
 * Classification rules:
 *   - Only the WWW-Authenticate `error=` parameter is inspected — never the body.
 *   - When credentials are absent: always AUTH_REQUIRED regardless of error code.
 *   - RFC 6750 `error="invalid_token"` + credentials → AUTH_INVALID (not AUTH_EXPIRED).
 *     RFC 6750 §3.1 states that invalid_token covers expired, revoked, AND malformed
 *     tokens; it is too broad to unambiguously signal expiry.
 *   - `error="expired"` or `error="token_expired"` + credentials → AUTH_EXPIRED.
 *   - Generic 401 (no error code) + credentials → AUTH_INVALID.
 *   - MCP Release cannot reliably distinguish expired from invalid for standard 401 responses.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCheck } from "../src/check.js";
import {
  startMissingTokenServer,
  startInvalidTokenServer,
  startExpiredTokenServer,
  startNonStandardExpiredTokenServer,
  startForbiddenResourceServer,
  type FixtureServer,
} from "../../../fixtures/servers/src/index.js";

const DEV = { allowHttp: true };
const TIMEOUT = 6000;

// ---------------------------------------------------------------------------
// AUTH_REQUIRED — 401 without credentials
// ---------------------------------------------------------------------------

describe("401 without credentials → AUTH_REQUIRED (WARNING)", () => {
  let server: FixtureServer;
  beforeAll(async () => { server = await startMissingTokenServer(); });
  afterAll(async () => server.close());

  it("overallStatus is WARNING", async () => {
    const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
    expect(report.overallStatus).toBe("WARNING");
  }, TIMEOUT);

  it("emits AUTH_REQUIRED with severity WARNING", async () => {
    const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
    const f = report.findings.find((f) => f.code === "AUTH_REQUIRED");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("WARNING");
  }, TIMEOUT);

  it("does not emit AUTH_INVALID or AUTH_EXPIRED", async () => {
    const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
    expect(report.findings.some((f) => f.code === "AUTH_INVALID")).toBe(false);
    expect(report.findings.some((f) => f.code === "AUTH_EXPIRED")).toBe(false);
  }, TIMEOUT);

  it("AUTH_REQUIRED even when server sends error=invalid_token but no credentials sent", async () => {
    const expServer = await startInvalidTokenServer();
    try {
      const report = await runCheck(expServer.url, { ...DEV, timeoutMs: 3000 });
      expect(report.overallStatus).toBe("WARNING");
      expect(report.findings.some((f) => f.code === "AUTH_REQUIRED")).toBe(true);
      expect(report.findings.some((f) => f.code === "AUTH_EXPIRED")).toBe(false);
      expect(report.findings.some((f) => f.code === "AUTH_INVALID")).toBe(false);
    } finally {
      await expServer.close();
    }
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// AUTH_INVALID — 401 with credentials, no RFC error code (generic 401)
// ---------------------------------------------------------------------------

describe("401 with credentials, no RFC error code → AUTH_INVALID (FAIL)", () => {
  let server: FixtureServer;
  beforeAll(async () => { server = await startMissingTokenServer(); }); // realm only, no error=
  afterAll(async () => server.close());

  it("overallStatus is FAIL", async () => {
    const report = await runCheck(server.url, {
      ...DEV,
      timeoutMs: 3000,
      requestHeaders: { Authorization: "Bearer some-token" },
    });
    expect(report.overallStatus).toBe("FAIL");
  }, TIMEOUT);

  it("emits AUTH_INVALID (not AUTH_EXPIRED) for generic 401", async () => {
    const report = await runCheck(server.url, {
      ...DEV,
      timeoutMs: 3000,
      requestHeaders: { Authorization: "Bearer wrong-token" },
    });
    expect(report.findings.some((f) => f.code === "AUTH_INVALID")).toBe(true);
    expect(report.findings.some((f) => f.code === "AUTH_EXPIRED")).toBe(false);
  }, TIMEOUT);

  it("emits AUTH_INVALID for x-api-key header on generic 401", async () => {
    const report = await runCheck(server.url, {
      ...DEV,
      timeoutMs: 3000,
      requestHeaders: { "x-api-key": "bad-key" },
    });
    expect(report.findings.some((f) => f.code === "AUTH_INVALID")).toBe(true);
  }, TIMEOUT);

  it("AUTH_INVALID message is fixed — no server body or header values", async () => {
    const report = await runCheck(server.url, {
      ...DEV,
      timeoutMs: 3000,
      requestHeaders: { Authorization: "Bearer bad" },
    });
    const f = report.findings.find((f) => f.code === "AUTH_INVALID")!;
    expect(f.message).toBe("Server rejected the provided credentials (401 Unauthorized).");
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// AUTH_INVALID — RFC 6750 error="invalid_token" + credentials → AUTH_INVALID
//
// RFC 6750 §3.1: "invalid_token" covers expired, revoked, AND malformed tokens.
// It is too broad to classify as AUTH_EXPIRED. Credentials + invalid_token → AUTH_INVALID.
// ---------------------------------------------------------------------------

describe("401 with credentials + error=invalid_token → AUTH_INVALID (FAIL)", () => {
  let server: FixtureServer;
  beforeAll(async () => { server = await startInvalidTokenServer(); }); // error="invalid_token"
  afterAll(async () => server.close());

  it("overallStatus is FAIL", async () => {
    const report = await runCheck(server.url, {
      ...DEV,
      timeoutMs: 3000,
      requestHeaders: { Authorization: "Bearer some-token" },
    });
    expect(report.overallStatus).toBe("FAIL");
  }, TIMEOUT);

  it("emits AUTH_INVALID (not AUTH_EXPIRED) when error=invalid_token", async () => {
    const report = await runCheck(server.url, {
      ...DEV,
      timeoutMs: 3000,
      requestHeaders: { Authorization: "Bearer some-token" },
    });
    expect(report.findings.some((f) => f.code === "AUTH_INVALID")).toBe(true);
    expect(report.findings.some((f) => f.code === "AUTH_EXPIRED")).toBe(false);
  }, TIMEOUT);

  it("AUTH_INVALID for x-api-key with error=invalid_token", async () => {
    const report = await runCheck(server.url, {
      ...DEV,
      timeoutMs: 3000,
      requestHeaders: { "x-api-key": "sk-some-key" },
    });
    expect(report.findings.some((f) => f.code === "AUTH_INVALID")).toBe(true);
    expect(report.findings.some((f) => f.code === "AUTH_EXPIRED")).toBe(false);
  }, TIMEOUT);

  it("AUTH_INVALID message does not leak header or body values", async () => {
    const report = await runCheck(server.url, {
      ...DEV,
      timeoutMs: 3000,
      requestHeaders: { Authorization: "Bearer some-token" },
    });
    const f = report.findings.find((f) => f.code === "AUTH_INVALID")!;
    expect(f.message).toBe("Server rejected the provided credentials (401 Unauthorized).");
    expect(f.message).not.toContain("invalid_token");
    expect(f.message).not.toContain("Token is invalid");
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// AUTH_EXPIRED — credentials + error="token_expired" (unambiguous expiry code)
// ---------------------------------------------------------------------------

describe("401 with credentials + error=token_expired → AUTH_EXPIRED (FAIL)", () => {
  let server: FixtureServer;
  beforeAll(async () => { server = await startExpiredTokenServer(); }); // error="token_expired"
  afterAll(async () => server.close());

  it("overallStatus is FAIL", async () => {
    const report = await runCheck(server.url, {
      ...DEV,
      timeoutMs: 3000,
      requestHeaders: { Authorization: "Bearer stale-token" },
    });
    expect(report.overallStatus).toBe("FAIL");
  }, TIMEOUT);

  it("emits AUTH_EXPIRED (not AUTH_INVALID) when error=token_expired", async () => {
    const report = await runCheck(server.url, {
      ...DEV,
      timeoutMs: 3000,
      requestHeaders: { Authorization: "Bearer stale-token" },
    });
    expect(report.findings.some((f) => f.code === "AUTH_EXPIRED")).toBe(true);
    expect(report.findings.some((f) => f.code === "AUTH_INVALID")).toBe(false);
  }, TIMEOUT);

  it("no credentials → AUTH_REQUIRED (not AUTH_EXPIRED)", async () => {
    const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
    expect(report.findings.some((f) => f.code === "AUTH_REQUIRED")).toBe(true);
    expect(report.findings.some((f) => f.code === "AUTH_EXPIRED")).toBe(false);
  }, TIMEOUT);

  it("does not leak WWW-Authenticate header value in findings", async () => {
    const report = await runCheck(server.url, {
      ...DEV,
      timeoutMs: 3000,
      requestHeaders: { Authorization: "Bearer stale-token" },
    });
    const allMessages = report.findings.map((f) => f.message).join(" ");
    expect(allMessages).not.toContain("realm");
    expect(allMessages).not.toContain("token_expired");
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// AUTH_EXPIRED — credentials + error="expired" (non-standard unambiguous code)
// ---------------------------------------------------------------------------

describe("401 with credentials + error=expired → AUTH_EXPIRED", () => {
  it("emits AUTH_EXPIRED for error=expired header", async () => {
    const server = await startNonStandardExpiredTokenServer();
    try {
      const report = await runCheck(server.url, {
        ...DEV,
        timeoutMs: 3000,
        requestHeaders: { Authorization: "Bearer expired" },
      });
      expect(report.findings.some((f) => f.code === "AUTH_EXPIRED")).toBe(true);
      expect(report.findings.some((f) => f.code === "AUTH_INVALID")).toBe(false);
    } finally {
      await server.close();
    }
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// AUTH_FORBIDDEN — 403
// ---------------------------------------------------------------------------

describe("403 → AUTH_FORBIDDEN (FAIL)", () => {
  let server: FixtureServer;
  beforeAll(async () => { server = await startForbiddenResourceServer(); });
  afterAll(async () => server.close());

  it("overallStatus is FAIL", async () => {
    const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
    expect(report.overallStatus).toBe("FAIL");
  }, TIMEOUT);

  it("emits AUTH_FORBIDDEN", async () => {
    const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
    const f = report.findings.find((f) => f.code === "AUTH_FORBIDDEN");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("FAIL");
  }, TIMEOUT);

  it("does not emit AUTH_REQUIRED or AUTH_INVALID or AUTH_EXPIRED", async () => {
    const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
    expect(report.findings.some((f) => f.code === "AUTH_REQUIRED")).toBe(false);
    expect(report.findings.some((f) => f.code === "AUTH_INVALID")).toBe(false);
    expect(report.findings.some((f) => f.code === "AUTH_EXPIRED")).toBe(false);
  }, TIMEOUT);

  it("does not leak server body in AUTH_FORBIDDEN message", async () => {
    const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
    const f = report.findings.find((f) => f.code === "AUTH_FORBIDDEN")!;
    expect(f.message).not.toContain('"forbidden"');
    expect(f.message).not.toContain("Insufficient");
  }, TIMEOUT);
});
