/**
 * Deliberately broken fixture servers for testing validation logic.
 * Each server exposes a specific violation to ensure the checker
 * produces the expected FAIL or WARNING findings.
 */
import { startRawFixture, type FixtureServer } from "./helpers.js";

/** Tool with an invalid name (contains spaces) */
export async function startInvalidToolNameServer(): Promise<FixtureServer> {
  return startRawFixture(async (req, res) => {
    const body = req.body as { method?: string; id?: unknown };
    if (body.method === "initialize") {
      res.json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "broken-invalid-name", version: "1.0.0" },
        },
      });
    } else if (body.method === "tools/list") {
      res.json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          tools: [
            {
              name: "invalid tool name!", // invalid: spaces and !
              description: "A tool with an invalid name",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        },
      });
    } else if (body.method === "notifications/initialized") {
      res.status(202).json({});
    } else {
      res.json({ jsonrpc: "2.0", id: body.id, result: {} });
    }
  });
}

/** Tool missing description */
export async function startMissingDescriptionServer(): Promise<FixtureServer> {
  return startRawFixture(async (req, res) => {
    const body = req.body as { method?: string; id?: unknown };
    if (body.method === "initialize") {
      res.json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "broken-missing-desc", version: "1.0.0" },
        },
      });
    } else if (body.method === "tools/list") {
      res.json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          tools: [
            {
              name: "no_description_tool",
              // description intentionally omitted
              inputSchema: { type: "object", properties: {} },
            },
          ],
        },
      });
    } else if (body.method === "notifications/initialized") {
      res.status(202).json({});
    } else {
      res.json({ jsonrpc: "2.0", id: body.id, result: {} });
    }
  });
}

/** Tool with invalid inputSchema (not a valid JSON Schema) */
export async function startInvalidInputSchemaServer(): Promise<FixtureServer> {
  return startRawFixture(async (req, res) => {
    const body = req.body as { method?: string; id?: unknown };
    if (body.method === "initialize") {
      res.json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "broken-invalid-schema", version: "1.0.0" },
        },
      });
    } else if (body.method === "tools/list") {
      res.json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          tools: [
            {
              name: "bad_schema_tool",
              description: "Tool with a broken input schema",
              inputSchema: "this is not a json schema object", // invalid
            },
          ],
        },
      });
    } else if (body.method === "notifications/initialized") {
      res.status(202).json({});
    } else {
      res.json({ jsonrpc: "2.0", id: body.id, result: {} });
    }
  });
}

/** Tool with invalid outputSchema */
export async function startInvalidOutputSchemaServer(): Promise<FixtureServer> {
  return startRawFixture(async (req, res) => {
    const body = req.body as { method?: string; id?: unknown };
    if (body.method === "initialize") {
      res.json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "broken-invalid-output", version: "1.0.0" },
        },
      });
    } else if (body.method === "tools/list") {
      res.json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          tools: [
            {
              name: "bad_output_schema_tool",
              description: "Tool with a broken output schema",
              inputSchema: { type: "object", properties: {} },
              outputSchema: ["not", "a", "schema"], // invalid: array instead of object
            },
          ],
        },
      });
    } else if (body.method === "notifications/initialized") {
      res.status(202).json({});
    } else {
      res.json({ jsonrpc: "2.0", id: body.id, result: {} });
    }
  });
}

/** Server that responds with a non-MCP error to trigger initialization failure */
export async function startInitializationFailureServer(): Promise<FixtureServer> {
  return startRawFixture((_req, res) => {
    res.status(500).json({ error: "Internal Server Error" });
  });
}

/** Server that never responds (triggers timeout) */
export async function startTimeoutServer(): Promise<FixtureServer> {
  return startRawFixture((_req, _res) => {
    // Never respond — trigger timeout
  });
}

/** Server that redirects excessively */
export async function startRedirectServer(
  maxHops = 5,
): Promise<FixtureServer> {
  let hopCount = 0;
  return startRawFixture((req, res) => {
    if (hopCount < maxHops) {
      hopCount++;
      const host = req.headers["host"] ?? "127.0.0.1";
      res.redirect(302, `http://${host}/mcp?hop=${hopCount}`);
    } else {
      hopCount = 0;
      res.json({
        jsonrpc: "2.0",
        id: null,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          serverInfo: { name: "redirect-server", version: "1.0.0" },
        },
      });
    }
  });
}

/**
 * Server that immediately redirects to a private IP address.
 * Used to verify that the redirect-destination SSRF guard fires.
 */
export async function startPrivateRedirectServer(): Promise<FixtureServer> {
  return startRawFixture((_req, res) => {
    res.redirect(302, "https://192.168.1.1/mcp");
  });
}

/**
 * Server that creates a redirect loop (A → A).
 * Our redirect loop detection should fire before the redirect-count limit.
 */
export async function startRedirectLoopServer(): Promise<FixtureServer> {
  return startRawFixture((req, res) => {
    const host = req.headers["host"] ?? "127.0.0.1";
    res.redirect(302, `http://${host}/mcp?loop=1`);
  });
}

/**
 * Server that sends a Content-Length header larger than our 10 MB limit.
 * We check the header before reading the body so no large allocation occurs.
 */
export async function startOversizedResponseServer(): Promise<FixtureServer> {
  return startRawFixture((_req, res) => {
    // 11 MB — exceeds our 10 MB limit
    res.setHeader("Content-Length", String(11 * 1024 * 1024));
    res.status(200).end();
  });
}

/** Server that always responds 401 with a configurable body. */
export async function startUnauthorizedServer(body: string = '{"error":"unauthorized"}', contentType = "application/json"): Promise<FixtureServer> {
  return startRawFixture((_req, res) => {
    res
      .setHeader("WWW-Authenticate", 'Bearer realm="mcp", scope="read"')
      .setHeader("Content-Type", contentType)
      .status(401)
      .send(body);
  });
}

/** Server that always responds 403. */
export async function startForbiddenServer(): Promise<FixtureServer> {
  return startRawFixture((_req, res) => {
    res.status(403).json({ error: "forbidden" });
  });
}

/** Server that always responds 500. */
export async function startInternalErrorServer(): Promise<FixtureServer> {
  return startRawFixture((_req, res) => {
    res.status(500).send("Internal Server Error");
  });
}

/**
 * Server that responds to every MCP POST with a JSON-RPC 2.0 error object.
 *
 * Simulates a server that rejects the `initialize` handshake at the protocol
 * layer — i.e., the HTTP response is 200 OK but the body is a JSON-RPC error.
 * The MCP SDK throws McpError{code} for this. Used to verify that MCP Release
 * classifies the result as INIT_FAILURE (not REMOTE_HTTP_ERROR).
 */
export async function startJsonRpcErrorServer(
  code = -32600,
  message = "Invalid Request",
): Promise<FixtureServer> {
  return startRawFixture((req, res) => {
    const body = req.body as { id?: unknown };
    const rawId = body.id;
    const id =
      typeof rawId === "string" || typeof rawId === "number" ? rawId : null;
    res.json({ jsonrpc: "2.0", id, error: { code, message } });
  });
}

/** Generic fixture: always responds with the given HTTP status and body. */
export async function startHttpStatusServer(
  status: number,
  body: string,
  contentType = "text/plain",
): Promise<FixtureServer> {
  return startRawFixture((_req, res) => {
    res.setHeader("Content-Type", contentType).status(status).send(body);
  });
}

