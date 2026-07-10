/**
 * Regression tests for cross-origin redirect credential stripping.
 *
 * Root cause: fetchChain captured requestHeaders from the connectToMcpServer
 * closure and re-merged them on every recursive call. When a cross-origin
 * redirect stripped sensitive headers from redirectInit.headers, the next
 * fetchChain call immediately re-added them from the closure, bypassing the
 * strip entirely.
 *
 * Fix: thread activeRequestHeaders explicitly through fetchChain; pass {} on
 * cross-origin redirect, pass activeRequestHeaders on same-origin redirect.
 * The initial call from fetchWithGuard passes requestHeaders explicitly.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { runCheck } from "../src/check.js";
import {
  startAuthenticatedServer,
  type FixtureServer,
} from "../../../fixtures/servers/src/index.js";

const TIMEOUT = 10_000;

// ---------------------------------------------------------------------------
// Minimal test-server helpers
// ---------------------------------------------------------------------------

type TestServer = { url: string; port: number; close: () => Promise<void> };

/**
 * Start a raw HTTP server on 127.0.0.1.
 * Returns the bound port so callers can build cross-origin redirect URLs.
 */
function startRaw(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<TestServer> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer(handler);
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${addr.port}/mcp`,
        port: addr.port,
        close: () =>
          new Promise<void>((res, rej) => {
            srv.closeAllConnections();
            srv.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}

/**
 * Parse an HTTP request body as JSON. Non-JSON bodies resolve to {}.
 */
function readBody(req: http.IncomingMessage): Promise<{ method?: string; id?: unknown }> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => { raw += chunk.toString(); });
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw) as { method?: string; id?: unknown });
      } catch {
        resolve({});
      }
    });
  });
}

/**
 * Minimal MCP-protocol handler.
 * Returns valid MCP JSON-RPC responses for POST initialize / notifications/initialized /
 * tools/list. Returns 405 for GET requests (SDK SSE subscription — not supported here).
 */
async function handleMcp(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  // The Streamable HTTP SDK issues an optional GET to subscribe to SSE events.
  // Return 405 so the SDK falls back to POST-only mode without failing the session.
  if (req.method === "GET") {
    res.writeHead(405, { "Content-Type": "application/json", Allow: "POST" });
    res.end(JSON.stringify({ error: "Method Not Allowed" }));
    return;
  }

  const body = await readBody(req);
  res.setHeader("Content-Type", "application/json");

  if (body.method === "initialize") {
    res.writeHead(200);
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "test", version: "1.0.0" },
        },
      }),
    );
  } else if (body.method === "notifications/initialized") {
    res.writeHead(202);
    res.end("{}");
  } else if (body.method === "tools/list") {
    res.writeHead(200);
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: { tools: [] },
      }),
    );
  } else {
    res.writeHead(200);
    res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }));
  }
}

/**
 * Start an MCP-capable server that FAILS (returns 401) if it receives the
 * named headers. Used to prove sensitive headers are NOT forwarded.
 */
function startMcpRejectIfHeader(rejectHeaders: string[]): Promise<TestServer> {
  return startRaw((req, res) => {
    for (const name of rejectHeaders) {
      if (req.headers[name.toLowerCase()]) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: `Credential leak: header "${name}" was forwarded cross-origin` }),
        );
        return;
      }
    }
    void handleMcp(req, res);
  });
}

/**
 * Start an MCP-capable server that FAILS (returns 400) if any of the named
 * headers are ABSENT. Used to prove non-sensitive headers are forwarded.
 */
function startMcpRequireHeader(requireHeaders: string[]): Promise<TestServer> {
  return startRaw((req, res) => {
    for (const name of requireHeaders) {
      if (!req.headers[name.toLowerCase()]) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: `Header "${name}" was unexpectedly absent` }),
        );
        return;
      }
    }
    void handleMcp(req, res);
  });
}

/** Start a server that always returns a 302 to the given target URL. */
function startRedirect(targetUrl: string): Promise<TestServer> {
  return startRaw((_req, res) => {
    res.writeHead(302, { Location: targetUrl });
    res.end();
  });
}

// maxRedirects must be higher than the default (3) because the MCP SDK makes
// multiple requests per session (initialize, GET-SSE, notifications, tools/list)
// and each one passes through the redirect server — 4 redirects in total.
const DEV = { allowHttp: true, timeoutMs: 5000, maxRedirects: 10 };

// ---------------------------------------------------------------------------
// 1. Authorization sent to initial (non-redirect) target
// ---------------------------------------------------------------------------

describe("credentials sent to initial target", () => {
  let server: FixtureServer;
  beforeAll(async () => { server = await startAuthenticatedServer("valid-token"); });
  afterAll(async () => server.close());

  it("Authorization header reaches the initial target", async () => {
    // startAuthenticatedServer returns 401 if the correct token is absent
    const report = await runCheck(server.url, {
      ...DEV,
      requestHeaders: { Authorization: "Bearer valid-token" },
    });
    expect(report.overallStatus).toBe("PASS");
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// 2. Same-origin redirect: Authorization preserved
// ---------------------------------------------------------------------------

describe("same-origin redirect preserves credentials", () => {
  it("Authorization header is present after a same-origin redirect", async () => {
    let requestCount = 0;

    // Single server that redirects the first request to itself (same origin,
    // different query param), then verifies Authorization on the second request.
    const srv = await startRaw((req, res) => {
      requestCount++;

      if (requestCount === 1) {
        // Redirect to self — same host, same port, different query string = same origin
        const loc = `http://127.0.0.1:${srv.port}/mcp?hop=2`;
        res.writeHead(302, { Location: loc });
        res.end();
        return;
      }

      // Second+ request: Authorization must be present (same-origin forwarding)
      if (!req.headers["authorization"]) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Authorization absent after same-origin redirect" }));
        return;
      }

      void handleMcp(req, res);
    });

    try {
      const report = await runCheck(srv.url, {
        ...DEV,
        requestHeaders: { Authorization: "Bearer same-origin-token" },
      });
      expect(report.overallStatus).toBe("PASS");
    } finally {
      await srv.close();
    }
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// 3. Cross-origin redirect: Authorization NOT forwarded
// ---------------------------------------------------------------------------

describe("cross-origin redirect does not forward Authorization", () => {
  it("Authorization is stripped before the cross-origin request", async () => {
    // Server B: valid MCP server that rejects if it receives Authorization
    const serverB = await startMcpRejectIfHeader(["authorization"]);
    // Server A: redirects to server B (different port = different origin)
    const serverA = await startRedirect(serverB.url);

    try {
      // Old buggy code: fetchChain re-merges Authorization from closure → B returns 401 → FAIL
      // Fixed code: activeRequestHeaders={} after cross-origin redirect → B sees no auth → PASS
      const report = await runCheck(serverA.url, {
        ...DEV,
        requestHeaders: { Authorization: "Bearer secret-token" },
      });
      expect(report.overallStatus).toBe("PASS");
    } finally {
      await serverA.close();
      await serverB.close();
    }
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// 4. Cross-origin redirect: Cookie NOT forwarded
// ---------------------------------------------------------------------------

describe("cross-origin redirect does not forward Cookie", () => {
  it("Cookie is stripped before the cross-origin request", async () => {
    const serverB = await startMcpRejectIfHeader(["cookie"]);
    const serverA = await startRedirect(serverB.url);

    try {
      const report = await runCheck(serverA.url, {
        ...DEV,
        requestHeaders: { Cookie: "session=abc123" },
      });
      expect(report.overallStatus).toBe("PASS");
    } finally {
      await serverA.close();
      await serverB.close();
    }
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// 5. Cross-origin redirect: X-API-Key NOT forwarded
// ---------------------------------------------------------------------------

describe("cross-origin redirect does not forward X-API-Key", () => {
  it("X-API-Key is stripped before the cross-origin request", async () => {
    const serverB = await startMcpRejectIfHeader(["x-api-key"]);
    const serverA = await startRedirect(serverB.url);

    try {
      const report = await runCheck(serverA.url, {
        ...DEV,
        requestHeaders: { "X-API-Key": "sk-supersecret" },
      });
      expect(report.overallStatus).toBe("PASS");
    } finally {
      await serverA.close();
      await serverB.close();
    }
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// 6. Cross-origin redirect: non-sensitive header IS forwarded
// ---------------------------------------------------------------------------

describe("cross-origin redirect forwards non-sensitive headers", () => {
  it("X-Custom-Id is present at the cross-origin redirect target", async () => {
    const serverB = await startMcpRequireHeader(["x-custom-id"]);
    const serverA = await startRedirect(serverB.url);

    try {
      const report = await runCheck(serverA.url, {
        ...DEV,
        requestHeaders: { "X-Custom-Id": "tenant-42" },
      });
      expect(report.overallStatus).toBe("PASS");
    } finally {
      await serverA.close();
      await serverB.close();
    }
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// 7. Web path: no requestHeaders → unaffected
// ---------------------------------------------------------------------------

describe("web-path check (no requestHeaders) is unaffected by fix", () => {
  let server: FixtureServer;
  beforeAll(async () => { server = await startAuthenticatedServer("any-token"); });
  afterAll(async () => server.close());

  it("runCheck without requestHeaders still reports AUTH_REQUIRED (not a regression)", async () => {
    // When no token is supplied, the server returns 401, which is AUTH_REQUIRED
    const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
    expect(report.overallStatus).toBe("WARNING");
    expect(report.findings.some((f) => f.code === "AUTH_REQUIRED")).toBe(true);
  }, TIMEOUT);
});
