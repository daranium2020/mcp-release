/**
 * Regression tests for REMOTE_HTTP_ERROR — server response body leakage fix.
 *
 * Root cause: HTTP 500 and other non-401/403 responses from the MCP endpoint
 * caused the SDK to throw StreamableHTTPError with the raw response body embedded
 * in its message. The generic TransportError branch forwarded err.message directly
 * into the client-facing TRANSPORT_ERROR finding, leaking arbitrary server content.
 *
 * Fix: extractHttpStatus() detects any numeric HTTP status. If a status is
 * recognized (httpStatus !== null) and is not 401/403, the finding is emitted as
 * REMOTE_HTTP_ERROR with a fixed message. The raw err.message is discarded.
 * Only genuine network failures (no HTTP status, null) still use err.message.
 */
import { describe, it, expect } from "vitest";
import { runCheck } from "../src/check.js";
import { startHttpStatusServer } from "../../../fixtures/servers/src/index.js";

const DEV = { allowHttp: true };
const TIMEOUT = 5000;
const SLOW = 8000;

const FIXED_MESSAGE = "Remote MCP server returned an unexpected HTTP response.";

// ---------------------------------------------------------------------------
// Helper: assert that no fragment of the given body appears in any finding
// ---------------------------------------------------------------------------
function assertBodyNotLeaked(
  report: Awaited<ReturnType<typeof runCheck>>,
  body: string,
) {
  const allMessages = report.findings.map((f) => f.message).join(" ");
  // Check significant tokens (length > 4 to skip noise like "JSON")
  for (const fragment of body.split(/[\s,;:{}[\]"'<>/=]+/).filter((s) => s.length > 4)) {
    expect(allMessages, `body fragment "${fragment}" must not appear in findings`).not.toContain(fragment);
  }
}

// ---------------------------------------------------------------------------
// 1. HTTP 500 — secret JSON body
// ---------------------------------------------------------------------------

describe("500 with secret JSON body — body never leaked", () => {
  it("no finding message contains the secret body content", async () => {
    const secretBody = '{"error":"internal","detail":"SECRET_DB_PASSWORD=hunter2","trace":"/app/server.ts:42"}';
    const server = await startHttpStatusServer(500, secretBody, "application/json");
    try {
      const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
      assertBodyNotLeaked(report, secretBody);
      expect(report.findings.some((f) => f.code === "REMOTE_HTTP_ERROR")).toBe(true);
      expect(report.findings.find((f) => f.code === "REMOTE_HTTP_ERROR")!.message).toBe(FIXED_MESSAGE);
    } finally {
      await server.close();
    }
  }, TIMEOUT);

  it("500 overallStatus is FAIL", async () => {
    const server = await startHttpStatusServer(500, '{"error":"oops"}', "application/json");
    try {
      const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
      expect(report.overallStatus).toBe("FAIL");
    } finally {
      await server.close();
    }
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// 2. HTTP 500 — malicious HTML body
// ---------------------------------------------------------------------------

describe("500 with malicious HTML body — body never leaked", () => {
  it("no finding message contains HTML tags or injected content", async () => {
    const htmlBody = '<html><body><script>alert("xss")</script><p>stacktrace at /app/secret.js:99</p></body></html>';
    const server = await startHttpStatusServer(500, htmlBody, "text/html");
    try {
      const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
      assertBodyNotLeaked(report, htmlBody);
      expect(report.findings.some((f) => f.code === "REMOTE_HTTP_ERROR")).toBe(true);
    } finally {
      await server.close();
    }
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// 3. HTTP 404 — multiline body
// ---------------------------------------------------------------------------

describe("404 with multiline body — body never leaked", () => {
  it("no finding message contains any line of the body", async () => {
    const multiBody = "Not Found\nEndpoint does not exist\nPath: /mcp\nServer: internal-app-1\nSecret: api_key_here";
    const server = await startHttpStatusServer(404, multiBody, "text/plain");
    try {
      const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
      assertBodyNotLeaked(report, multiBody);
      expect(report.findings.some((f) => f.code === "REMOTE_HTTP_ERROR")).toBe(true);
      expect(report.findings.find((f) => f.code === "REMOTE_HTTP_ERROR")!.message).toBe(FIXED_MESSAGE);
    } finally {
      await server.close();
    }
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// 4. HTTP 429 — token-like body
// ---------------------------------------------------------------------------

describe("429 with token-like body — body never leaked", () => {
  it("no finding message contains the rate-limit body including token patterns", async () => {
    const tokenBody = '{"error":"rate_limited","retry_after":60,"token":"eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.secret","scope":"read:all"}';
    const server = await startHttpStatusServer(429, tokenBody, "application/json");
    try {
      const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
      assertBodyNotLeaked(report, tokenBody);
      expect(report.findings.some((f) => f.code === "REMOTE_HTTP_ERROR")).toBe(true);
    } finally {
      await server.close();
    }
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// 5. HTTP 502 Bad Gateway
// ---------------------------------------------------------------------------

describe("502 Bad Gateway — body never leaked", () => {
  it("classified as REMOTE_HTTP_ERROR with fixed message", async () => {
    const gatewayBody = "<html>502 Bad Gateway — upstream: http://internal-proxy:8080/mcp</html>";
    const server = await startHttpStatusServer(502, gatewayBody, "text/html");
    try {
      const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
      assertBodyNotLeaked(report, gatewayBody);
      const f = report.findings.find((f) => f.code === "REMOTE_HTTP_ERROR")!;
      expect(f).toBeDefined();
      expect(f.message).toBe(FIXED_MESSAGE);
      expect(f.severity).toBe("FAIL");
    } finally {
      await server.close();
    }
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// 6. HTTP 503 Service Unavailable
// ---------------------------------------------------------------------------

describe("503 Service Unavailable — body never leaked", () => {
  it("classified as REMOTE_HTTP_ERROR with fixed message", async () => {
    const body = '{"error":"service_unavailable","maintenance":true,"internal_endpoint":"https://internal.corp/status"}';
    const server = await startHttpStatusServer(503, body, "application/json");
    try {
      const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
      assertBodyNotLeaked(report, body);
      expect(report.findings.some((f) => f.code === "REMOTE_HTTP_ERROR")).toBe(true);
    } finally {
      await server.close();
    }
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// 7. Arbitrary non-401/403 status codes
// ---------------------------------------------------------------------------

describe("arbitrary non-401/403 HTTP status codes — all classified as REMOTE_HTTP_ERROR", () => {
  const cases: Array<{ status: number; label: string }> = [
    { status: 400, label: "400 Bad Request" },
    { status: 405, label: "405 Method Not Allowed" },
    { status: 408, label: "408 Request Timeout" },
    { status: 409, label: "409 Conflict" },
    { status: 422, label: "422 Unprocessable Entity" },
    { status: 504, label: "504 Gateway Timeout" },
    { status: 418, label: "418 I'm a Teapot" },
  ];

  for (const { status, label } of cases) {
    it(`${label} → REMOTE_HTTP_ERROR / FAIL / fixed message`, async () => {
      const secretBody = `SECRET_BODY_FOR_${status}_UNIQUE_MARKER host=internal-node-${status}`;
      const server = await startHttpStatusServer(status, secretBody, "text/plain");
      try {
        const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });

        // Body must not appear in any finding
        assertBodyNotLeaked(report, secretBody);

        // Finding must be REMOTE_HTTP_ERROR
        const f = report.findings.find((f) => f.code === "REMOTE_HTTP_ERROR");
        expect(f, `expected REMOTE_HTTP_ERROR for ${status}`).toBeDefined();
        expect(f!.severity).toBe("FAIL");
        expect(f!.message).toBe(FIXED_MESSAGE);

        // No TRANSPORT_ERROR for recognized HTTP statuses
        expect(report.findings.some((f) => f.code === "TRANSPORT_ERROR")).toBe(false);
        // No AUTH_REQUIRED
        expect(report.findings.some((f) => f.code === "AUTH_REQUIRED")).toBe(false);

        expect(report.overallStatus).toBe("FAIL");
      } finally {
        await server.close();
      }
    }, TIMEOUT);
  }
});

// ---------------------------------------------------------------------------
// 8. 401 and 403 classification unchanged after fix
// ---------------------------------------------------------------------------

describe("401 and 403 classification unchanged", () => {
  it("401 is still AUTH_REQUIRED / WARNING / fixed message", async () => {
    const server = await startHttpStatusServer(401, '{"error":"unauthorized","token":"leaked-token"}', "application/json");
    try {
      const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
      const f = report.findings.find((f) => f.code === "AUTH_REQUIRED");
      expect(f).toBeDefined();
      expect(f!.severity).toBe("WARNING");
      expect(f!.message).toBe("Server requires authorization. Authenticated checks were not performed.");
      expect(report.overallStatus).toBe("WARNING");
      // Must not contain token text
      expect(report.findings.some((f) => f.message.includes("leaked-token"))).toBe(false);
    } finally {
      await server.close();
    }
  }, TIMEOUT);

  it("403 is still HTTP_ERROR / FAIL / fixed message", async () => {
    const server = await startHttpStatusServer(403, '{"error":"forbidden","path":"/secret/admin"}', "application/json");
    try {
      const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
      const f = report.findings.find((f) => f.code === "HTTP_ERROR");
      expect(f).toBeDefined();
      expect(f!.severity).toBe("FAIL");
      expect(f!.message).toBe("Server returned 403 Forbidden. Access denied.");
      expect(report.overallStatus).toBe("FAIL");
      // Body must not leak
      expect(report.findings.some((f) => f.message.includes("/secret/admin"))).toBe(false);
    } finally {
      await server.close();
    }
  }, TIMEOUT);

  it("401 is not classified as REMOTE_HTTP_ERROR", async () => {
    const server = await startHttpStatusServer(401, "unauthorized", "text/plain");
    try {
      const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
      expect(report.findings.some((f) => f.code === "REMOTE_HTTP_ERROR")).toBe(false);
    } finally {
      await server.close();
    }
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// 9. Genuine connection failure remains TRANSPORT_ERROR
// ---------------------------------------------------------------------------

describe("genuine connection failures remain TRANSPORT_ERROR", () => {
  it("ECONNREFUSED to localhost:1 → TRANSPORT_ERROR / FAIL", async () => {
    const report = await runCheck("http://localhost:1/mcp", { ...DEV, timeoutMs: 3000 });
    expect(report.overallStatus).toBe("FAIL");
    expect(report.findings.some((f) => f.code === "TRANSPORT_ERROR")).toBe(true);
    expect(report.findings.some((f) => f.code === "REMOTE_HTTP_ERROR")).toBe(false);
    expect(report.findings.some((f) => f.code === "AUTH_REQUIRED")).toBe(false);
  }, SLOW);
});

// ---------------------------------------------------------------------------
// 10. Magic-substring bypass prevention — adversarial bodies
//
// Before the fix, the check.ts classification looked at err.message substrings
// ("timeout", "Redirect limit", "Redirect loop", "Protocol downgrade") before
// extracting the HTTP status. A malicious server could embed one of those strings
// in its response body to bypass the safe HTTP-status path and leak the full body
// via TIMEOUT / REDIRECT_LIMIT_EXCEEDED / REDIRECT_LOOP / PROTOCOL_DOWNGRADE findings.
//
// After the fix: extractHttpStatus() runs first. Any non-null numeric status is
// classified by status alone. Substring matching only runs for httpStatus === null
// (genuine transport failures).
// ---------------------------------------------------------------------------

describe("magic-substring bypass — recognized HTTP status is always classified by status", () => {
  const SECRET = "UNIQUE_SECRET_MARKER_MUST_NOT_APPEAR";

  const adversarialCases: Array<{ status: number; body: string; label: string }> = [
    {
      status: 500,
      label: "500 body contains 'timeout'",
      body: `timeout ${SECRET} LEAK_SECRET_PASSWORD=hunter2 internal-host`,
    },
    {
      status: 404,
      label: "404 body contains 'Redirect limit'",
      body: `Redirect limit ${SECRET} LEAK_SECRET_2 /admin/path`,
    },
    {
      status: 429,
      label: "429 body contains 'Redirect loop'",
      body: `Redirect loop ${SECRET} token=secret_token_value`,
    },
    {
      status: 502,
      label: "502 body contains 'Protocol downgrade'",
      body: `Protocol downgrade ${SECRET} LEAK_SECRET_4 <script>alert(1)</script>`,
    },
    {
      status: 503,
      label: "503 body contains all four trigger phrases",
      body: `timeout Redirect limit Redirect loop Protocol downgrade ${SECRET} MEGA_SECRET_COMBINED credentials=hunter2`,
    },
    {
      status: 500,
      label: "500 multiline HTML body with trigger phrases",
      body: `<html>\n<body>timeout\nRedirect limit\n${SECRET}\n/internal/path</body>\n</html>`,
    },
    {
      status: 500,
      label: "500 JSON body with trigger phrases",
      body: `{"error":"timeout","detail":"Redirect loop","token":"${SECRET}","path":"/admin"}`,
    },
  ];

  for (const { status, label, body } of adversarialCases) {
    it(`${label} → REMOTE_HTTP_ERROR (not misclassified by body substring)`, async () => {
      const server = await startHttpStatusServer(status, body, "text/plain");
      try {
        const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });

        // Must be classified as REMOTE_HTTP_ERROR — never as TIMEOUT/REDIRECT_*/PROTOCOL_DOWNGRADE
        const f = report.findings.find((f) => f.code === "REMOTE_HTTP_ERROR");
        expect(f, `expected REMOTE_HTTP_ERROR for ${status} with trigger body`).toBeDefined();
        expect(f!.severity).toBe("FAIL");
        expect(f!.message).toBe(FIXED_MESSAGE);

        // The unique secret marker must not appear in any finding
        const allMessages = report.findings.map((f) => f.message).join(" ");
        expect(allMessages).not.toContain(SECRET);
        expect(allMessages).not.toContain("hunter2");
        expect(allMessages).not.toContain("MEGA_SECRET");

        // Must not be misclassified as a transport error type
        expect(report.findings.some((f) => f.code === "TIMEOUT")).toBe(false);
        expect(report.findings.some((f) => f.code === "REDIRECT_LIMIT_EXCEEDED")).toBe(false);
        expect(report.findings.some((f) => f.code === "REDIRECT_LOOP")).toBe(false);
        expect(report.findings.some((f) => f.code === "PROTOCOL_DOWNGRADE")).toBe(false);
        expect(report.findings.some((f) => f.code === "TRANSPORT_ERROR")).toBe(false);
        expect(report.findings.some((f) => f.code === "AUTH_REQUIRED")).toBe(false);

        expect(report.overallStatus).toBe("FAIL");
      } finally {
        await server.close();
      }
    }, TIMEOUT);
  }

  it("401 with 'timeout' body → still AUTH_REQUIRED (not TIMEOUT)", async () => {
    const body = `timeout LEAK_FROM_401 ${SECRET}`;
    const server = await startHttpStatusServer(401, body, "text/plain");
    try {
      const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
      expect(report.findings.some((f) => f.code === "AUTH_REQUIRED")).toBe(true);
      expect(report.findings.some((f) => f.code === "TIMEOUT")).toBe(false);
      const allMessages = report.findings.map((f) => f.message).join(" ");
      expect(allMessages).not.toContain(SECRET);
      expect(allMessages).not.toContain("LEAK_FROM_401");
    } finally {
      await server.close();
    }
  }, TIMEOUT);

  it("403 with 'Redirect loop' body → still HTTP_ERROR (not REDIRECT_LOOP)", async () => {
    const body = `Redirect loop LEAK_FROM_403 ${SECRET}`;
    const server = await startHttpStatusServer(403, body, "text/plain");
    try {
      const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
      expect(report.findings.some((f) => f.code === "HTTP_ERROR")).toBe(true);
      expect(report.findings.some((f) => f.code === "REDIRECT_LOOP")).toBe(false);
      const allMessages = report.findings.map((f) => f.message).join(" ");
      expect(allMessages).not.toContain(SECRET);
      expect(allMessages).not.toContain("LEAK_FROM_403");
    } finally {
      await server.close();
    }
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// 11. Genuine transport conditions still classify correctly (no regression)
//
// These confirm that gating substring matching behind httpStatus === null
// did not break classification of real transport errors that carry no HTTP status.
// Detailed fixture tests live in check.integration.test.ts (timeout, redirect
// limit, redirect loop). This section confirms SSRF and connection-refused remain
// unaffected by the ordering change.
// ---------------------------------------------------------------------------

describe("genuine transport conditions — no regression after ordering fix", () => {
  it("SSRF private IPv4 still blocked with SSRF_BLOCKED", async () => {
    const report = await runCheck("https://10.0.0.1/mcp", { timeoutMs: 2000 });
    expect(report.overallStatus).toBe("FAIL");
    expect(report.findings.some((f) => f.code === "SSRF_BLOCKED")).toBe(true);
    expect(report.findings.some((f) => f.code === "REMOTE_HTTP_ERROR")).toBe(false);
  }, TIMEOUT);

  it("HTTPS_REQUIRED still fires for plain HTTP to external host", async () => {
    const report = await runCheck("http://example.com/mcp", { timeoutMs: 2000 });
    expect(report.findings.some((f) => f.code === "HTTPS_REQUIRED")).toBe(true);
    expect(report.findings.some((f) => f.code === "REMOTE_HTTP_ERROR")).toBe(false);
  }, TIMEOUT);

  it("ECONNREFUSED still → TRANSPORT_ERROR (no HTTP status means no REMOTE_HTTP_ERROR)", async () => {
    const report = await runCheck("http://localhost:1/mcp", { ...DEV, timeoutMs: 3000 });
    expect(report.findings.some((f) => f.code === "TRANSPORT_ERROR")).toBe(true);
    expect(report.findings.some((f) => f.code === "REMOTE_HTTP_ERROR")).toBe(false);
  }, SLOW);
});
