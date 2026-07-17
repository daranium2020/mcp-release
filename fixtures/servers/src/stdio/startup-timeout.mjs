#!/usr/bin/env node
// Fixture: never responds to MCP initialization.
// Should trigger TIMEOUT (FAIL) after startupTimeoutMs.

// Consume stdin so the process stays alive, but never write anything valid to stdout
const rl = (await import("node:readline")).createInterface({
  input: process.stdin,
  terminal: false,
});

rl.on("line", () => {
  // Deliberately ignore all messages
});

rl.on("close", () => {
  process.exit(0);
});
