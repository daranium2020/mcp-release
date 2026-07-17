#!/usr/bin/env node
// Fixture: valid MCP stdio server with one "echo" tool.
// All protocol messages go to stdout; logs go to stderr.

import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin, terminal: false });

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

rl.on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  if (msg.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "valid-fixture-server", version: "1.0.0" },
      },
    });
  } else if (msg.method === "notifications/initialized") {
    // No response needed for notifications
  } else if (msg.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        tools: [
          {
            name: "echo",
            description: "Returns the input string unchanged.",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string", description: "Text to echo" } },
              required: ["text"],
            },
          },
        ],
      },
    });
  } else if (msg.id !== undefined) {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      error: { code: -32601, message: "Method not found" },
    });
  }
});

rl.on("close", () => {
  process.exit(0);
});
