#!/usr/bin/env node
// Fixture: writes non-JSON log lines to stdout before and after protocol messages.
// Should trigger STDIO_UNEXPECTED_OUTPUT (WARNING).

import { createInterface } from "node:readline";

// Incorrectly logging to stdout instead of stderr
process.stdout.write("Server starting up...\n");

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
    process.stdout.write("Got initialize request\n"); // spurious log
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "stdout-logger-fixture", version: "1.0.0" },
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
            name: "noop",
            description: "Does nothing.",
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
  process.exit(0);
});
