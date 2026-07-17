#!/usr/bin/env node
// Fixture: correct stdio server that logs to stderr (not stdout).
// Should produce a PASS report with no STDIO_UNEXPECTED_OUTPUT warnings.

import { createInterface } from "node:readline";

process.stderr.write("[stderr-logger] server started\n");

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

  process.stderr.write(`[stderr-logger] received: ${msg.method ?? "response"}\n`);

  if (msg.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "stderr-logger-fixture", version: "1.0.0" },
      },
    });
  } else if (msg.method === "notifications/initialized") {
    // No response needed
  } else if (msg.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        tools: [
          {
            name: "greet",
            description: "Returns a greeting.",
            inputSchema: { type: "object", properties: {}, required: [] },
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
  process.stderr.write("[stderr-logger] shutting down\n");
  process.exit(0);
});
