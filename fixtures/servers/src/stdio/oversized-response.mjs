#!/usr/bin/env node
// Fixture: writes a payload larger than the test-configured size limit.
// Tests pass maxResponseSizeBytes: 1024 — this fixture writes 2 KB,
// so the limit is exceeded without needing to transfer large data.
// Should trigger STDIO_RESPONSE_SIZE_EXCEEDED (FAIL).

// Write ~2 KB of JSON data as a single line
const payload = JSON.stringify({ data: "x".repeat(2048) });
process.stdout.write(payload + "\n");

const rl = (await import("node:readline")).createInterface({
  input: process.stdin,
  terminal: false,
});

rl.on("close", () => {
  process.exit(0);
});
