/**
 * Regression tests for AUTH_REQUIRED classification.
 *
 * Root cause: 401 responses from the MCP endpoint were wrapped by the SDK in a
 * StreamableHTTPError (numeric .code = 401) and then re-wrapped as TransportError,
 * which caused the generic TRANSPORT_ERROR branch to emit a FAIL finding that
 * included the raw server response body in the message.
 *
 * Fix: extractHttpStatus() detects the numeric HTTP status on the TransportError
 * cause and classifies 401 as AUTH_REQUIRED / WARNING (fixed message, no body),
 * 403 as HTTP_ERROR / FAIL (fixed message, no body).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCheck } from "../src/check.js";
import {
  startUnauthorizedServer,
  startForbiddenServer,
  startInternalErrorServer,
  type FixtureServer,
} from "../../../fixtures/servers/src/index.js";
import { startValidServer } from "../../../fixtures/servers/src/index.js";

const DEV = { allowHttp: true };
const TIMEOUT = 5000;
const SLOW = 8000;

// ---------------------------------------------------------------------------
// 1. AUTH_REQUIRED — 401 classification
// ---------------------------------------------------------------------------

describe("401 → AUTH_REQUIRED classification", () => {
  let server: FixtureServer;
  beforeAll(async () => { server = await startUnauthorizedServer(); });
  afterAll(async () => server.close());

  it("overallStatus is WARNING (not FAIL)", async () => {
    const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
    expect(report.overallStatus).toBe("WARNING");
  }, TIMEOUT);

  it("finding code is AUTH_REQUIRED", async () => {
    const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
    const f = report.findings.find((f) => f.code === "AUTH_REQUIRED");
    expect(f).toBeDefined();
  }, TIMEOUT);

  it("finding severity is WARNING", async () => {
    const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
    const f = report.findings.find((f) => f.code === "AUTH_REQUIRED")!;
    expect(f.severity).toBe("WARNING");
  }, TIMEOUT);

  it("finding message is the fixed string — no server body", async () => {
    const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
    const f = report.findings.find((f) => f.code === "AUTH_REQUIRED")!;
    expect(f.message).toBe(
      "Server requires authorization. Authenticated checks were not performed.",
    );
  }, TIMEOUT);

  it("no TRANSPORT_ERROR finding is emitted for 401", async () => {
    const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
    expect(report.findings.some((f) => f.code === "TRANSPORT_ERROR")).toBe(false);
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// 2. Raw response body never leaks — tested with various body contents
// ---------------------------------------------------------------------------

describe("401 — raw response body never reaches the finding", () => {
  const bodies = [
    { label: "JSON body",     ct: "application/json", body: '{"error":"Bearer token required","realm":"mcp"}' },
    { label: "text body",     ct: "text/plain",        body: "Authorization required" },
    { label: "malicious HTML",ct: "text/html",         body: '<script>alert(1)</script><b>Unauthorized</b>' },
    { label: "multiline",     ct: "text/plain",        body: "line1\nline2\r\nline3\tsecret_token=abc" },
    { label: "WWW-Authenticate present", ct: "application/json", body: '{"error":"invalid_token"}' },
  ];

  for (const { label, ct, body } of bodies) {
    it(`${label} — body text not in any finding message`, async () => {
      const server = await startUnauthorizedServer(body, ct);
      try {
        const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
        const allMessages = report.findings.map((f) => f.message).join(" ");
        // Body content must not appear in any finding
        for (const fragment of body.split(/\s+/).filter((s) => s.length > 4)) {
          expect(allMessages).not.toContain(fragment);
        }
        // The fixed AUTH_REQUIRED message must be present
        expect(allMessages).toContain(
          "Server requires authorization. Authenticated checks were not performed.",
        );
      } finally {
        await server.close();
      }
    }, TIMEOUT);
  }

  it("WWW-Authenticate header value not in any finding", async () => {
    const server = await startUnauthorizedServer();
    try {
      const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
      const allMessages = report.findings.map((f) => f.message).join(" ");
      expect(allMessages).not.toContain("Bearer realm");
      expect(allMessages).not.toContain("scope=");
    } finally {
      await server.close();
    }
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// 3. AUTH_REQUIRED — no protocol/tool checks claimed as passed
// ---------------------------------------------------------------------------

describe("401 — protocol and tool checks not marked passed", () => {
  let server: FixtureServer;
  beforeAll(async () => { server = await startUnauthorizedServer(); });
  afterAll(async () => server.close());

  it("INIT_OK is not emitted", async () => {
    const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
    expect(report.findings.some((f) => f.code === "INIT_OK")).toBe(false);
  }, TIMEOUT);

  it("TOOLS_LIST_OK is not emitted", async () => {
    const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
    expect(report.findings.some((f) => f.code === "TOOLS_LIST_OK")).toBe(false);
  }, TIMEOUT);

  it("tools array is empty", async () => {
    const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
    expect(report.tools).toHaveLength(0);
  }, TIMEOUT);

  it("protocolVersion is null", async () => {
    const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
    expect(report.protocolVersion).toBeNull();
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// 4. 403 Forbidden — AUTH_FORBIDDEN (v0.3.0: separate code, not HTTP_ERROR)
// ---------------------------------------------------------------------------

describe("403 → AUTH_FORBIDDEN classification (not AUTH_REQUIRED, not HTTP_ERROR)", () => {
  let server: FixtureServer;
  beforeAll(async () => { server = await startForbiddenServer(); });
  afterAll(async () => server.close());

  it("403 is not classified as AUTH_REQUIRED", async () => {
    const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
    expect(report.findings.some((f) => f.code === "AUTH_REQUIRED")).toBe(false);
  }, TIMEOUT);

  it("403 is classified as AUTH_FORBIDDEN", async () => {
    const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
    expect(report.findings.some((f) => f.code === "AUTH_FORBIDDEN")).toBe(true);
  }, TIMEOUT);

  it("403 overallStatus is FAIL", async () => {
    const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
    expect(report.overallStatus).toBe("FAIL");
  }, TIMEOUT);

  it("403 finding message does not include response body", async () => {
    const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
    const f = report.findings.find((f) => f.code === "AUTH_FORBIDDEN")!;
    expect(f).toBeDefined();
    expect(f.message).not.toContain('"forbidden"');
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// 5. 500 — generic remote failure (not AUTH_REQUIRED)
// ---------------------------------------------------------------------------

describe("500 → REMOTE_HTTP_ERROR (not AUTH_REQUIRED)", () => {
  let server: FixtureServer;
  beforeAll(async () => { server = await startInternalErrorServer(); });
  afterAll(async () => server.close());

  it("500 is not classified as AUTH_REQUIRED", async () => {
    const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
    expect(report.findings.some((f) => f.code === "AUTH_REQUIRED")).toBe(false);
  }, TIMEOUT);

  it("500 is classified as REMOTE_HTTP_ERROR", async () => {
    const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
    expect(report.findings.some((f) => f.code === "REMOTE_HTTP_ERROR")).toBe(true);
  }, TIMEOUT);

  it("500 overallStatus is FAIL", async () => {
    const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
    expect(report.overallStatus).toBe("FAIL");
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// 6. Genuine network failures remain TRANSPORT_ERROR
// ---------------------------------------------------------------------------

describe("connection failure remains TRANSPORT_ERROR", () => {
  it("ECONNREFUSED to localhost:1 is still TRANSPORT_ERROR / FAIL", async () => {
    const report = await runCheck("http://localhost:1/mcp", {
      ...DEV,
      timeoutMs: 3000,
    });
    expect(report.overallStatus).toBe("FAIL");
    expect(report.findings.some((f) => f.code === "TRANSPORT_ERROR")).toBe(true);
    expect(report.findings.some((f) => f.code === "AUTH_REQUIRED")).toBe(false);
  }, SLOW);
});

// ---------------------------------------------------------------------------
// 7. SSRF blocking unchanged
// ---------------------------------------------------------------------------

describe("SSRF blocking unchanged after AUTH_REQUIRED fix", () => {
  it("blocks private IPv4", async () => {
    const report = await runCheck("https://10.0.0.1/mcp", { timeoutMs: 2000 });
    expect(report.overallStatus).toBe("FAIL");
    expect(report.findings.some((f) => f.code === "SSRF_BLOCKED")).toBe(true);
  }, TIMEOUT);

  it("blocks plain HTTP to external host", async () => {
    const report = await runCheck("http://example.com/mcp", { timeoutMs: 2000 });
    expect(report.findings.some((f) => f.code === "HTTPS_REQUIRED")).toBe(true);
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// 8. Authenticated (valid) MCP server behavior unchanged
// ---------------------------------------------------------------------------

describe("valid server — behavior unchanged after AUTH_REQUIRED fix", () => {
  let server: FixtureServer;
  beforeAll(async () => { server = await startValidServer(); });
  afterAll(async () => server.close());

  it("still returns PASS for a valid server", async () => {
    const report = await runCheck(server.url, { ...DEV, timeoutMs: 5000 });
    expect(report.overallStatus).toBe("PASS");
    expect(report.findings.some((f) => f.code === "INIT_OK")).toBe(true);
  }, SLOW);

  it("no AUTH_REQUIRED finding for a healthy server", async () => {
    const report = await runCheck(server.url, { ...DEV, timeoutMs: 5000 });
    expect(report.findings.some((f) => f.code === "AUTH_REQUIRED")).toBe(false);
  }, SLOW);
});
