/**
 * Fixture servers for v0.3.0 auth & resilience scenarios.
 */
import net from "node:net";
import { startRawFixture, type FixtureServer } from "./helpers.js";

/** Always returns 401 with WWW-Authenticate (no Retry-After). */
export async function startMissingTokenServer(): Promise<FixtureServer> {
  return startRawFixture((_req, res) => {
    res
      .setHeader("WWW-Authenticate", 'Bearer realm="mcp"')
      .status(401)
      .json({ error: "unauthorized", message: "Missing credentials" });
  });
}

/** Returns 401 for any request — simulates invalid/expired token. */
export async function startInvalidTokenServer(): Promise<FixtureServer> {
  return startRawFixture((_req, res) => {
    res
      .setHeader("WWW-Authenticate", 'Bearer error="invalid_token"')
      .status(401)
      .json({ error: "invalid_token", message: "Token is invalid or expired" });
  });
}

/** Returns 403 for any request — simulates a forbidden resource. */
export async function startForbiddenResourceServer(): Promise<FixtureServer> {
  return startRawFixture((_req, res) => {
    res.status(403).json({ error: "forbidden", message: "Insufficient permissions" });
  });
}

/**
 * Returns 429 with a Retry-After in seconds, then succeeds on subsequent calls.
 * Useful for testing that the retry logic honours Retry-After correctly.
 */
export async function startRateLimitThenSuccessServer(
  retryAfterSeconds = 1,
): Promise<FixtureServer> {
  let callCount = 0;
  return startRawFixture(async (req, res) => {
    callCount++;
    if (callCount === 1) {
      res
        .setHeader("Retry-After", String(retryAfterSeconds))
        .status(429)
        .json({ error: "rate_limited", message: "Too many requests" });
      return;
    }
    // Subsequent calls behave as a valid MCP server
    const body = req.body as { method?: string; id?: unknown };
    if (body.method === "initialize") {
      res.json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "rate-limit-server", version: "1.0.0" },
        },
      });
    } else if (body.method === "tools/list") {
      res.json({
        jsonrpc: "2.0",
        id: body.id,
        result: { tools: [{ name: "echo", description: "Echo tool", inputSchema: { type: "object", properties: {} } }] },
      });
    } else if (body.method === "notifications/initialized") {
      res.status(202).json({});
    } else {
      res.json({ jsonrpc: "2.0", id: body.id, result: {} });
    }
  });
}

/**
 * Always returns 429 — useful for testing retry exhaustion.
 * Supports both seconds and HTTP-date Retry-After formats.
 */
export async function startAlwaysRateLimitServer(
  retryAfter: string = "1",
): Promise<FixtureServer> {
  return startRawFixture((_req, res) => {
    res
      .setHeader("Retry-After", retryAfter)
      .status(429)
      .json({ error: "rate_limited", message: "Rate limit exceeded" });
  });
}

/**
 * Returns 429 with an HTTP-date Retry-After header, then succeeds.
 */
export async function startRateLimitDateServer(delaySeconds = 1): Promise<FixtureServer> {
  let callCount = 0;
  return startRawFixture(async (req, res) => {
    callCount++;
    if (callCount === 1) {
      const retryDate = new Date(Date.now() + delaySeconds * 1000).toUTCString();
      res
        .setHeader("Retry-After", retryDate)
        .status(429)
        .json({ error: "rate_limited" });
      return;
    }
    const body = req.body as { method?: string; id?: unknown };
    if (body.method === "initialize") {
      res.json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "rate-limit-date-server", version: "1.0.0" },
        },
      });
    } else if (body.method === "tools/list") {
      res.json({ jsonrpc: "2.0", id: body.id, result: { tools: [] } });
    } else if (body.method === "notifications/initialized") {
      res.status(202).json({});
    } else {
      res.json({ jsonrpc: "2.0", id: body.id, result: {} });
    }
  });
}

/**
 * Returns 500 for the first N calls, then succeeds.
 * Used to test transient-failure retry.
 */
export async function startTransientFailureServer(failCount = 1): Promise<FixtureServer> {
  let calls = 0;
  return startRawFixture(async (req, res) => {
    calls++;
    if (calls <= failCount) {
      res.status(500).send("Internal Server Error");
      return;
    }
    const body = req.body as { method?: string; id?: unknown };
    if (body.method === "initialize") {
      res.json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "transient-fail-server", version: "1.0.0" },
        },
      });
    } else if (body.method === "tools/list") {
      res.json({ jsonrpc: "2.0", id: body.id, result: { tools: [] } });
    } else if (body.method === "notifications/initialized") {
      res.status(202).json({});
    } else {
      res.json({ jsonrpc: "2.0", id: body.id, result: {} });
    }
  });
}

/**
 * Returns 401 with WWW-Authenticate: Bearer error="token_expired".
 * Uses a non-standard but unambiguously expiry-specific code so that this
 * fixture produces AUTH_EXPIRED. The RFC 6750 "invalid_token" code is NOT
 * used here — it covers expired, revoked, and malformed tokens and therefore
 * produces AUTH_INVALID per MCP Release classification rules.
 */
export async function startExpiredTokenServer(): Promise<FixtureServer> {
  return startRawFixture((_req, res) => {
    res
      .setHeader(
        "WWW-Authenticate",
        'Bearer realm="mcp", error="token_expired"',
      )
      .status(401)
      .json({ error: "token_expired" });
  });
}

/**
 * Returns 401 with a non-standard WWW-Authenticate: Bearer error="expired".
 * Tests that non-standard "expired" codes are also detected as AUTH_EXPIRED.
 */
export async function startNonStandardExpiredTokenServer(): Promise<FixtureServer> {
  return startRawFixture((_req, res) => {
    res
      .setHeader("WWW-Authenticate", 'Bearer realm="mcp", error="expired"')
      .status(401)
      .json({ error: "expired" });
  });
}

/** Server that accepts the connection but never sends a response body — triggers response timeout. */
export async function startResponseTimeoutServer(): Promise<FixtureServer> {
  return startRawFixture((_req, _res) => {
    // Accept but never respond — triggers response timeout
  });
}

/**
 * Raw TCP server that accepts TCP connections but never completes the TLS handshake.
 * Use with an https:// URL and allowPrivateNetworks: true.
 * The TLS connect phase hangs until the outer timeoutMs fires → CONNECT_TIMEOUT.
 *
 * Accepted sockets are tracked so that close() can destroy them immediately:
 * net.Server.close() only stops accepting new connections — it waits for all
 * existing connections to close before calling its callback. Without explicit
 * destruction the server would never finish closing (and tests would hang).
 */
export async function startConnectTimeoutServer(): Promise<FixtureServer> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    // Intentionally send nothing — TLS ClientHello arrives but no ServerHello is sent.
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  return {
    url: `https://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((res) => {
        // Destroy all pending sockets so server.close() callback fires promptly.
        for (const s of sockets) s.destroy();
        server.close(() => res());
      }),
  };
}
