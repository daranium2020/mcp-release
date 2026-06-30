/**
 * MCP Release validation test matrix.
 *
 * Runs runCheck against controlled fixture endpoints and asserts the expected
 * overallStatus and meaningful finding codes for each scenario:
 *
 *   PASS           /mcp               — valid server, valid tools
 *   WARNING        /mcp-warning       — tool with empty description
 *   FAIL           /mcp-fail          — tool with invalid name
 *   AUTH_REQUIRED  /mcp-auth          — server returns 401
 *   PROTOCOL_ERROR /mcp-protocol-error — JSON-RPC error on initialize → INIT_FAILURE
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleMcpRequest } from "../src/mcp-handler";
import {
  handleWarningRequest,
  handleFailRequest,
  handleAuthRequest,
  handleProtocolErrorRequest,
} from "../src/matrix-handler";
import { runCheck } from "@mcp-release/core";
import type { CheckReport } from "@mcp-release/core";

// ---------------------------------------------------------------------------
// Test HTTP server
// ---------------------------------------------------------------------------

type TestServer = { url: string; close: () => Promise<void> };

async function startMatrixServer(): Promise<TestServer> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(
      async (req: IncomingMessage, res: ServerResponse) => {
        try {
          const urlStr = `http://${req.headers["host"] ?? "localhost"}${req.url ?? "/"}`;
          const chunks: Buffer[] = [];
          await new Promise<void>((ok, fail) => {
            req.on("data", (c: Buffer) => chunks.push(c));
            req.on("end", ok);
            req.on("error", fail);
          });
          const body = Buffer.concat(chunks);
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(req.headers)) {
            if (typeof v === "string") headers[k] = v;
          }
          const method = req.method ?? "GET";
          const webReq = new Request(urlStr, {
            method,
            headers,
            body: method !== "GET" && method !== "HEAD" && body.length > 0 ? body : null,
          });

          const path = new URL(urlStr).pathname;
          let webRes: Response;
          switch (path) {
            case "/mcp":
              webRes = await handleMcpRequest(webReq);
              break;
            case "/mcp-warning":
              webRes = await handleWarningRequest(webReq);
              break;
            case "/mcp-fail":
              webRes = await handleFailRequest(webReq);
              break;
            case "/mcp-auth":
              webRes = handleAuthRequest(webReq);
              break;
            case "/mcp-protocol-error":
              webRes = await handleProtocolErrorRequest(webReq);
              break;
            default:
              webRes = new Response(JSON.stringify({ error: "NOT_FOUND" }), {
                status: 404,
                headers: { "Content-Type": "application/json" },
              });
          }

          res.statusCode = webRes.status;
          webRes.headers.forEach((v, k) => res.setHeader(k, v));
          const buf = Buffer.from(await webRes.arrayBuffer());
          res.end(buf);
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: "INTERNAL" }));
          console.error("Matrix test server error:", err);
        }
      },
    );
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to get server address"));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise<void>((res, rej) => {
            server.closeAllConnections();
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function allFindings(report: CheckReport) {
  return [...report.findings, ...report.tools.flatMap((t) => t.findings)];
}

const CHECK_OPTS = { allowHttp: true, timeoutMs: 8000 } as const;

// ---------------------------------------------------------------------------
// Matrix
// ---------------------------------------------------------------------------

describe("Validation test matrix", () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startMatrixServer();
  });
  afterAll(async () => server.close());

  // --------------------------------------------------------------------------
  // PASS — /mcp
  // --------------------------------------------------------------------------

  describe("PASS — /mcp (valid server with valid tools)", () => {
    it("overallStatus is PASS", async () => {
      const report = await runCheck(`${server.url}/mcp`, CHECK_OPTS);
      expect(report.overallStatus).toBe("PASS");
    }, 15000);

    it("INIT_OK finding is present", async () => {
      const report = await runCheck(`${server.url}/mcp`, CHECK_OPTS);
      expect(report.findings.some((f) => f.code === "INIT_OK")).toBe(true);
    }, 15000);

    it("TOOLS_LIST_OK finding is present", async () => {
      const report = await runCheck(`${server.url}/mcp`, CHECK_OPTS);
      expect(report.findings.some((f) => f.code === "TOOLS_LIST_OK")).toBe(true);
    }, 15000);

    it("no FAIL or WARNING findings", async () => {
      const report = await runCheck(`${server.url}/mcp`, CHECK_OPTS);
      expect(allFindings(report).every((f) => f.severity === "PASS")).toBe(true);
    }, 15000);

    it("at least two tools discovered", async () => {
      const report = await runCheck(`${server.url}/mcp`, CHECK_OPTS);
      expect(report.tools.length).toBeGreaterThanOrEqual(2);
    }, 15000);
  });

  // --------------------------------------------------------------------------
  // WARNING — /mcp-warning
  // --------------------------------------------------------------------------

  describe("WARNING — /mcp-warning (tool with empty description)", () => {
    it("overallStatus is WARNING", async () => {
      const report = await runCheck(`${server.url}/mcp-warning`, CHECK_OPTS);
      expect(report.overallStatus).toBe("WARNING");
    }, 15000);

    it("INIT_OK is present (connection succeeded)", async () => {
      const report = await runCheck(`${server.url}/mcp-warning`, CHECK_OPTS);
      expect(report.findings.some((f) => f.code === "INIT_OK")).toBe(true);
    }, 15000);

    it("TOOLS_LIST_OK is present", async () => {
      const report = await runCheck(`${server.url}/mcp-warning`, CHECK_OPTS);
      expect(report.findings.some((f) => f.code === "TOOLS_LIST_OK")).toBe(true);
    }, 15000);

    it("TOOL_EMPTY_DESCRIPTION finding is present", async () => {
      const report = await runCheck(`${server.url}/mcp-warning`, CHECK_OPTS);
      expect(
        allFindings(report).some((f) => f.code === "TOOL_EMPTY_DESCRIPTION"),
      ).toBe(true);
    }, 15000);

    it("TOOL_EMPTY_DESCRIPTION finding names the affected tool", async () => {
      const report = await runCheck(`${server.url}/mcp-warning`, CHECK_OPTS);
      const finding = allFindings(report).find(
        (f) => f.code === "TOOL_EMPTY_DESCRIPTION",
      );
      expect(finding?.message).toContain("undescribed_tool");
    }, 15000);

    it("TOOL_EMPTY_DESCRIPTION finding has WARNING severity", async () => {
      const report = await runCheck(`${server.url}/mcp-warning`, CHECK_OPTS);
      const finding = allFindings(report).find(
        (f) => f.code === "TOOL_EMPTY_DESCRIPTION",
      );
      expect(finding?.severity).toBe("WARNING");
    }, 15000);

    it("no FAIL findings", async () => {
      const report = await runCheck(`${server.url}/mcp-warning`, CHECK_OPTS);
      expect(allFindings(report).some((f) => f.severity === "FAIL")).toBe(false);
    }, 15000);
  });

  // --------------------------------------------------------------------------
  // FAIL — /mcp-fail
  // --------------------------------------------------------------------------

  describe("FAIL — /mcp-fail (tool with invalid name)", () => {
    it("overallStatus is FAIL", async () => {
      const report = await runCheck(`${server.url}/mcp-fail`, CHECK_OPTS);
      expect(report.overallStatus).toBe("FAIL");
    }, 15000);

    it("INIT_OK is present (connection succeeded)", async () => {
      const report = await runCheck(`${server.url}/mcp-fail`, CHECK_OPTS);
      expect(report.findings.some((f) => f.code === "INIT_OK")).toBe(true);
    }, 15000);

    it("TOOLS_LIST_OK is present", async () => {
      const report = await runCheck(`${server.url}/mcp-fail`, CHECK_OPTS);
      expect(report.findings.some((f) => f.code === "TOOLS_LIST_OK")).toBe(true);
    }, 15000);

    it("TOOL_INVALID_NAME finding is present", async () => {
      const report = await runCheck(`${server.url}/mcp-fail`, CHECK_OPTS);
      expect(
        allFindings(report).some((f) => f.code === "TOOL_INVALID_NAME"),
      ).toBe(true);
    }, 15000);

    it("TOOL_INVALID_NAME finding mentions the offending name", async () => {
      const report = await runCheck(`${server.url}/mcp-fail`, CHECK_OPTS);
      const finding = allFindings(report).find(
        (f) => f.code === "TOOL_INVALID_NAME",
      );
      expect(finding?.message).toContain("invalid tool name!");
    }, 15000);

    it("TOOL_INVALID_NAME finding has FAIL severity", async () => {
      const report = await runCheck(`${server.url}/mcp-fail`, CHECK_OPTS);
      const finding = allFindings(report).find(
        (f) => f.code === "TOOL_INVALID_NAME",
      );
      expect(finding?.severity).toBe("FAIL");
    }, 15000);
  });

  // --------------------------------------------------------------------------
  // AUTH_REQUIRED — /mcp-auth
  // --------------------------------------------------------------------------

  describe("AUTH_REQUIRED — /mcp-auth (server returns 401)", () => {
    it("overallStatus is WARNING", async () => {
      const report = await runCheck(`${server.url}/mcp-auth`, CHECK_OPTS);
      expect(report.overallStatus).toBe("WARNING");
    }, 15000);

    it("AUTH_REQUIRED finding is present", async () => {
      const report = await runCheck(`${server.url}/mcp-auth`, CHECK_OPTS);
      expect(report.findings.some((f) => f.code === "AUTH_REQUIRED")).toBe(
        true,
      );
    }, 15000);

    it("AUTH_REQUIRED finding has WARNING severity", async () => {
      const report = await runCheck(`${server.url}/mcp-auth`, CHECK_OPTS);
      const finding = report.findings.find((f) => f.code === "AUTH_REQUIRED");
      expect(finding?.severity).toBe("WARNING");
    }, 15000);

    it("AUTH_REQUIRED message explains that authenticated checks were not performed", async () => {
      const report = await runCheck(`${server.url}/mcp-auth`, CHECK_OPTS);
      const finding = report.findings.find((f) => f.code === "AUTH_REQUIRED");
      expect(finding?.message.toLowerCase()).toContain("authorization");
    }, 15000);

    it("INIT_OK is absent (protocol init did not succeed)", async () => {
      const report = await runCheck(`${server.url}/mcp-auth`, CHECK_OPTS);
      expect(report.findings.some((f) => f.code === "INIT_OK")).toBe(false);
    }, 15000);

    it("no tools were discovered", async () => {
      const report = await runCheck(`${server.url}/mcp-auth`, CHECK_OPTS);
      expect(report.tools).toHaveLength(0);
    }, 15000);
  });

  // --------------------------------------------------------------------------
  // PROTOCOL_ERROR — /mcp-protocol-error
  //
  // The server returns a JSON-RPC error response to initialize.
  // The MCP SDK throws McpError{code: -32600}. extractHttpStatus() rejects
  // negative codes (not in the 100–599 HTTP range); extractRpcErrorCode()
  // detects the negative integer and routes it to INIT_FAILURE FAIL.
  // --------------------------------------------------------------------------

  describe("PROTOCOL_ERROR — /mcp-protocol-error (JSON-RPC error on initialize)", () => {
    it("overallStatus is FAIL", async () => {
      const report = await runCheck(
        `${server.url}/mcp-protocol-error`,
        CHECK_OPTS,
      );
      expect(report.overallStatus).toBe("FAIL");
    }, 15000);

    it("INIT_FAILURE finding is present (correct protocol-error classification)", async () => {
      const report = await runCheck(
        `${server.url}/mcp-protocol-error`,
        CHECK_OPTS,
      );
      expect(
        report.findings.some((f) => f.code === "INIT_FAILURE"),
      ).toBe(true);
    }, 15000);

    it("INIT_FAILURE finding has FAIL severity", async () => {
      const report = await runCheck(
        `${server.url}/mcp-protocol-error`,
        CHECK_OPTS,
      );
      const f = report.findings.find((f) => f.code === "INIT_FAILURE");
      expect(f?.severity).toBe("FAIL");
    }, 15000);

    it("INIT_FAILURE message is the fixed protocol-error string", async () => {
      const report = await runCheck(
        `${server.url}/mcp-protocol-error`,
        CHECK_OPTS,
      );
      const f = report.findings.find((f) => f.code === "INIT_FAILURE");
      expect(f?.message).toBe(
        "MCP initialization failed: the server returned a protocol error.",
      );
    }, 15000);

    it("INIT_FAILURE context carries the JSON-RPC error code (-32600)", async () => {
      const report = await runCheck(
        `${server.url}/mcp-protocol-error`,
        CHECK_OPTS,
      );
      const f = report.findings.find((f) => f.code === "INIT_FAILURE");
      expect(f?.context?.["rpcCode"]).toBe(-32600);
    }, 15000);

    it("is NOT classified as REMOTE_HTTP_ERROR", async () => {
      const report = await runCheck(
        `${server.url}/mcp-protocol-error`,
        CHECK_OPTS,
      );
      expect(
        report.findings.some((f) => f.code === "REMOTE_HTTP_ERROR"),
      ).toBe(false);
    }, 15000);

    it("INIT_OK is absent (protocol initialization failed)", async () => {
      const report = await runCheck(
        `${server.url}/mcp-protocol-error`,
        CHECK_OPTS,
      );
      expect(report.findings.some((f) => f.code === "INIT_OK")).toBe(false);
    }, 15000);

    it("no tools were discovered", async () => {
      const report = await runCheck(
        `${server.url}/mcp-protocol-error`,
        CHECK_OPTS,
      );
      expect(report.tools).toHaveLength(0);
    }, 15000);
  });
});
