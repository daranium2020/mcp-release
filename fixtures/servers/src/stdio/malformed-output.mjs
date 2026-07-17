#!/usr/bin/env node
// Fixture: writes valid JSON that is NOT a valid MCP message.
// Should trigger STDIO_FRAMING_ERROR (FAIL) and INIT_FAILURE.

// Immediately send valid JSON that fails the JSONRPCMessageSchema
process.stdout.write(JSON.stringify({ not: "mcp", protocol: true }) + "\n");
process.stdout.write(JSON.stringify({ also: "wrong", missing: "jsonrpc" }) + "\n");

// Never send a real initialize response — the client will error/timeout
const rl = (await import("node:readline")).createInterface({
  input: process.stdin,
  terminal: false,
});

rl.on("close", () => {
  process.exit(0);
});
