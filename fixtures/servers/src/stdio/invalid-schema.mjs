#!/usr/bin/env node
// Fixture: valid MCP server but returns tools with invalid inputSchema objects.
// Uses schemas that the MCP SDK accepts but Ajv rejects during meta-schema validation.
// Should trigger TOOL_INVALID_INPUT_SCHEMA (FAIL).

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
        serverInfo: { name: "invalid-schema-fixture", version: "1.0.0" },
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
            name: "bad_additional_props",
            description: "Tool whose inputSchema has additionalProperties as a string.",
            // additionalProperties must be boolean or schema object — Ajv rejects this
            inputSchema: {
              type: "object",
              properties: { text: { type: "string" } },
              additionalProperties: "not-valid",
            },
          },
          {
            name: "bad_min_properties",
            description: "Tool whose inputSchema has minProperties as a non-integer.",
            // minProperties must be an integer — Ajv rejects this
            inputSchema: {
              type: "object",
              properties: { value: { type: "number" } },
              minProperties: "not-a-number",
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
