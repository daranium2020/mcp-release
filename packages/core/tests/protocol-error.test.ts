/**
 * Regression tests for JSON-RPC protocol error classification.
 *
 * Root cause: extractHttpStatus() accepted any finite numeric .code on
 * TransportError.cause. When the MCP SDK throws McpError{code: -32600} in
 * response to a JSON-RPC error reply from the server, -32600 is a finite
 * number, so it was routed to the REMOTE_HTTP_ERROR branch — the same branch
 * used for real HTTP 400/500 responses. This is wrong: -32600 is a JSON-RPC
 * error code, not an HTTP status code.
 *
 * Fix: extractHttpStatus() now rejects any code outside the valid HTTP range
 * (100–599). A new extractRpcErrorCode() helper detects negative finite
 * integers (JSON-RPC codes). The classification chain routes those to
 * INIT_FAILURE FAIL with a fixed message and safe numeric context.
 */
import { describe, it, expect } from "vitest";
import { runCheck } from "../src/check.js";
import { startJsonRpcErrorServer, startHttpStatusServer } from "../../../fixtures/servers/src/index.js";

const DEV = { allowHttp: true };
const TIMEOUT = 8000;

// ---------------------------------------------------------------------------
// 1. Standard JSON-RPC error codes → INIT_FAILURE (not REMOTE_HTTP_ERROR)
// ---------------------------------------------------------------------------

describe("JSON-RPC -32600 (Invalid Request) → INIT_FAILURE", () => {
  it("overallStatus is FAIL", async () => {
    const server = await startJsonRpcErrorServer(-32600, "Invalid Request");
    try {
      const report = await runCheck(server.url, { ...DEV, timeoutMs: 5000 });
      expect(report.overallStatus).toBe("FAIL");
    } finally {
      await server.close();
    }
  }, TIMEOUT);

  it("finding code is INIT_FAILURE", async () => {
    const server = await startJsonRpcErrorServer(-32600, "Invalid Request");
    try {
      const report = await runCheck(server.url, { ...DEV, timeoutMs: 5000 });
      expect(report.findings.some((f) => f.code === "INIT_FAILURE")).toBe(true);
    } finally {
      await server.close();
    }
  }, TIMEOUT);

  it("finding severity is FAIL", async () => {
    const server = await startJsonRpcErrorServer(-32600, "Invalid Request");
    try {
      const report = await runCheck(server.url, { ...DEV, timeoutMs: 5000 });
      const f = report.findings.find((f) => f.code === "INIT_FAILURE");
      expect(f?.severity).toBe("FAIL");
    } finally {
      await server.close();
    }
  }, TIMEOUT);

  it("finding message is the fixed string — no server message body", async () => {
    const server = await startJsonRpcErrorServer(-32600, "UNIQUE_SECRET_RPC_MESSAGE_DO_NOT_LEAK");
    try {
      const report = await runCheck(server.url, { ...DEV, timeoutMs: 5000 });
      const f = report.findings.find((f) => f.code === "INIT_FAILURE");
      expect(f?.message).toBe(
        "MCP initialization failed: the server returned a protocol error.",
      );
      // Server-supplied JSON-RPC error message must not appear in any finding
      const allMessages = report.findings.map((f) => f.message).join(" ");
      expect(allMessages).not.toContain("UNIQUE_SECRET_RPC_MESSAGE_DO_NOT_LEAK");
    } finally {
      await server.close();
    }
  }, TIMEOUT);

  it("finding context carries rpcCode -32600", async () => {
    const server = await startJsonRpcErrorServer(-32600, "Invalid Request");
    try {
      const report = await runCheck(server.url, { ...DEV, timeoutMs: 5000 });
      const f = report.findings.find((f) => f.code === "INIT_FAILURE");
      expect(f?.context?.["rpcCode"]).toBe(-32600);
    } finally {
      await server.close();
    }
  }, TIMEOUT);

  it("is NOT classified as REMOTE_HTTP_ERROR", async () => {
    const server = await startJsonRpcErrorServer(-32600, "Invalid Request");
    try {
      const report = await runCheck(server.url, { ...DEV, timeoutMs: 5000 });
      expect(report.findings.some((f) => f.code === "REMOTE_HTTP_ERROR")).toBe(false);
    } finally {
      await server.close();
    }
  }, TIMEOUT);

  it("INIT_OK is absent", async () => {
    const server = await startJsonRpcErrorServer(-32600, "Invalid Request");
    try {
      const report = await runCheck(server.url, { ...DEV, timeoutMs: 5000 });
      expect(report.findings.some((f) => f.code === "INIT_OK")).toBe(false);
    } finally {
      await server.close();
    }
  }, TIMEOUT);

  it("no tools were discovered", async () => {
    const server = await startJsonRpcErrorServer(-32600, "Invalid Request");
    try {
      const report = await runCheck(server.url, { ...DEV, timeoutMs: 5000 });
      expect(report.tools).toHaveLength(0);
    } finally {
      await server.close();
    }
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// 2. Other standard JSON-RPC codes are also not HTTP statuses
// ---------------------------------------------------------------------------

describe("JSON-RPC error codes -32601, -32602, -32603 → INIT_FAILURE (not REMOTE_HTTP_ERROR)", () => {
  const cases: Array<{ code: number; name: string }> = [
    { code: -32601, name: "Method not found" },
    { code: -32602, name: "Invalid params" },
    { code: -32603, name: "Internal error" },
  ];

  for (const { code, name } of cases) {
    it(`JSON-RPC ${code} (${name}) → INIT_FAILURE FAIL (not REMOTE_HTTP_ERROR)`, async () => {
      const server = await startJsonRpcErrorServer(code, name);
      try {
        const report = await runCheck(server.url, { ...DEV, timeoutMs: 5000 });
        expect(report.overallStatus).toBe("FAIL");
        expect(report.findings.some((f) => f.code === "INIT_FAILURE")).toBe(true);
        expect(report.findings.some((f) => f.code === "REMOTE_HTTP_ERROR")).toBe(false);
        const f = report.findings.find((f) => f.code === "INIT_FAILURE");
        expect(f?.context?.["rpcCode"]).toBe(code);
      } finally {
        await server.close();
      }
    }, TIMEOUT);
  }
});

// ---------------------------------------------------------------------------
// 3. Genuine HTTP errors are unaffected — still REMOTE_HTTP_ERROR
// ---------------------------------------------------------------------------

describe("genuine HTTP error responses still classified as REMOTE_HTTP_ERROR", () => {
  it("HTTP 400 Bad Request → REMOTE_HTTP_ERROR FAIL", async () => {
    const server = await startHttpStatusServer(400, '{"error":"bad_request"}', "application/json");
    try {
      const report = await runCheck(server.url, { ...DEV, timeoutMs: 5000 });
      expect(report.overallStatus).toBe("FAIL");
      expect(report.findings.some((f) => f.code === "REMOTE_HTTP_ERROR")).toBe(true);
      expect(report.findings.some((f) => f.code === "INIT_FAILURE")).toBe(false);
    } finally {
      await server.close();
    }
  }, TIMEOUT);

  it("HTTP 500 Internal Server Error → REMOTE_HTTP_ERROR FAIL", async () => {
    const server = await startHttpStatusServer(500, '{"error":"internal"}', "application/json");
    try {
      const report = await runCheck(server.url, { ...DEV, timeoutMs: 5000 });
      expect(report.overallStatus).toBe("FAIL");
      expect(report.findings.some((f) => f.code === "REMOTE_HTTP_ERROR")).toBe(true);
      expect(report.findings.some((f) => f.code === "INIT_FAILURE")).toBe(false);
    } finally {
      await server.close();
    }
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// 4. AUTH_REQUIRED behavior unchanged
// ---------------------------------------------------------------------------

describe("AUTH_REQUIRED (HTTP 401) behavior unchanged after JSON-RPC fix", () => {
  it("HTTP 401 → AUTH_REQUIRED WARNING (not INIT_FAILURE)", async () => {
    const server = await startHttpStatusServer(401, '{"error":"unauthorized"}', "application/json");
    try {
      const report = await runCheck(server.url, { ...DEV, timeoutMs: 5000 });
      expect(report.overallStatus).toBe("WARNING");
      expect(report.findings.some((f) => f.code === "AUTH_REQUIRED")).toBe(true);
      expect(report.findings.some((f) => f.code === "INIT_FAILURE")).toBe(false);
      expect(report.findings.some((f) => f.code === "REMOTE_HTTP_ERROR")).toBe(false);
    } finally {
      await server.close();
    }
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// 5. Server-supplied JSON-RPC error message never leaked to findings
// ---------------------------------------------------------------------------

describe("JSON-RPC error message body never leaked to finding messages", () => {
  it("INIT_FAILURE message is fixed, not derived from server error message", async () => {
    const sensitiveMessage = "SUPER_SECRET_DB_CREDENTIAL_LEAK host=db.internal token=abc123xyz";
    const server = await startJsonRpcErrorServer(-32600, sensitiveMessage);
    try {
      const report = await runCheck(server.url, { ...DEV, timeoutMs: 5000 });
      const allMessages = report.findings.map((f) => f.message).join(" ");
      // Secret fragments must not appear
      expect(allMessages).not.toContain("SUPER_SECRET_DB_CREDENTIAL_LEAK");
      expect(allMessages).not.toContain("abc123xyz");
      expect(allMessages).not.toContain("db.internal");
      // The fixed message must be present
      expect(allMessages).toContain(
        "MCP initialization failed: the server returned a protocol error.",
      );
    } finally {
      await server.close();
    }
  }, TIMEOUT);
});
