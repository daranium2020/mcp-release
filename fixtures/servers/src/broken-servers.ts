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

