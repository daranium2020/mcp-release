import http from "node:http";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

export type FixtureServer = {
  url: string;
  close: () => Promise<void>;
};

/**
 * Start a fixture MCP server. A fresh McpServer + transport is created per
 * request to comply with SDK stateless mode requirements.
 */
export async function startMcpFixture(
  setup: (server: McpServer) => void,
  port = 0,
): Promise<FixtureServer> {
  const app = express();
  app.use(express.json());

  app.all("/mcp", async (req, res) => {
    const mcpServer = new McpServer({
      name: "fixture-server",
      version: "1.0.0",
    });

    setup(mcpServer);

    // exactOptionalPropertyTypes prevents passing `undefined` for sessionIdGenerator;
    // the cast ensures stateless mode (sessionIdGenerator absent) compiles correctly.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transport = new StreamableHTTPServerTransport({} as any);

    // Cast required: SDK's transport type has optional properties
    // (onclose, onerror, etc.) that aren't aligned with Transport interface.
    await mcpServer.connect(transport as unknown as Transport);

    try {
      await transport.handleRequest(req, res, req.body as Record<string, unknown>);
    } finally {
      // Each request gets its own transport; clean up after handling.
      await mcpServer.close().catch(() => undefined);
    }
  });

  return startHttpServer(app, port);
}

export async function startRawFixture(
  handler: (
    req: express.Request,
    res: express.Response,
  ) => void | Promise<void>,
  port = 0,
): Promise<FixtureServer> {
  const app = express();
  app.use(express.json());
  app.all("/mcp", (req, res) => {
    void handler(req, res);
  });

  return startHttpServer(app, port);
}

function startHttpServer(
  app: express.Express,
  port: number,
): Promise<FixtureServer> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to get server address"));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}/mcp`,
        close: () =>
          new Promise<void>((res, rej) => {
            // closeAllConnections() terminates keep-alive and SSE connections immediately.
            // Without this, server.close() blocks until clients disconnect.
            server.closeAllConnections();
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}
