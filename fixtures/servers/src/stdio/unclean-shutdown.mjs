#!/usr/bin/env node
// Fixture: valid MCP server that ignores SIGTERM and doesn't exit on stdin EOF.
// Should trigger STDIO_SHUTDOWN_TIMEOUT (WARNING) after shutdownTimeoutMs.

import { createInterface } from "node:readline";

// Ignore SIGTERM — the process must be killed with SIGKILL
process.on("SIGTERM", () => {
  // Deliberately do nothing — forcing SIGKILL
});

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
        serverInfo: { name: "unclean-shutdown-fixture", version: "1.0.0" },
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
            name: "stubborn",
            description: "Tool from a server that doesn't shut down cleanly.",
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

// Don't exit on stdin EOF — force the transport to use SIGKILL
rl.on("close", () => {
  // Stay alive — setInterval keeps the event loop running
  setInterval(() => {}, 60_000);
});
