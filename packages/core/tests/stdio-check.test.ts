import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { runStdioCheck } from "../src/stdio-check.js";
import { parseShellCommand } from "../src/stdio-transport.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, "../../../fixtures/servers/src/stdio");

function fixture(name: string): string {
  return `node ${join(FIXTURE_DIR, name)}`;
}

// ── parseShellCommand unit tests ─────────────────────────────────────────────

describe("parseShellCommand", () => {
  it("splits a simple command", () => {
    const [exe, args] = parseShellCommand("node ./server.js");
    expect(exe).toBe("node");
    expect(args).toEqual(["./server.js"]);
  });

  it("handles double-quoted segments", () => {
    const [exe, args] = parseShellCommand('npx -y "my mcp-server" --flag');
    expect(exe).toBe("npx");
    expect(args).toEqual(["-y", "my mcp-server", "--flag"]);
  });

  it("handles single-quoted segments", () => {
    const [exe, args] = parseShellCommand("npx -y 'my server'");
    expect(exe).toBe("npx");
    expect(args).toEqual(["-y", "my server"]);
  });

  it("handles backslash escape inside double quotes", () => {
    const [exe, args] = parseShellCommand('node "path\\ with\\ spaces"');
    expect(exe).toBe("node");
    expect(args).toEqual(["path with spaces"]);
  });

  it("throws on empty command", () => {
    expect(() => parseShellCommand("")).toThrow("Command must not be empty");
    expect(() => parseShellCommand("   ")).toThrow("Command must not be empty");
  });

  it("returns no args for single-word command", () => {
    const [exe, args] = parseShellCommand("node");
    expect(exe).toBe("node");
    expect(args).toEqual([]);
  });
});

// ── Fixture integration tests ────────────────────────────────────────────────

describe("valid-server", () => {
  it("returns PASS with INIT_OK and tool list", async () => {
    const report = await runStdioCheck({ command: fixture("valid-server.mjs") });
    expect(report.overallStatus).toBe("PASS");
    expect(report.findings.some((f) => f.code === "INIT_OK" && f.severity === "PASS")).toBe(true);
    expect(report.findings.some((f) => f.code === "TOOLS_LIST_OK")).toBe(true);
    expect(report.tools.length).toBeGreaterThan(0);
    expect(report.tools[0]?.name).toBe("echo");
    expect(report.transport).toBeNull();
  });

  it("sets serverUrl to stdio:<executable>", async () => {
    const report = await runStdioCheck({ command: fixture("valid-server.mjs") });
    expect(report.serverUrl).toMatch(/^stdio:/);
  });

  it("sets protocolVersion from server implementation version", async () => {
    const report = await runStdioCheck({ command: fixture("valid-server.mjs") });
    // getServerVersion().version returns the serverInfo version ("1.0.0"),
    // consistent with how runCheck works for HTTP transport.
    expect(report.protocolVersion).toBe("1.0.0");
  });
});

describe("stderr-logger", () => {
  it("returns PASS — stderr logs don't trigger STDIO_UNEXPECTED_OUTPUT", async () => {
    const report = await runStdioCheck({ command: fixture("stderr-logger.mjs") });
    expect(report.overallStatus).toBe("PASS");
    expect(report.findings.some((f) => f.code === "STDIO_UNEXPECTED_OUTPUT")).toBe(false);
    expect(report.tools.length).toBeGreaterThan(0);
  });
});

describe("stdout-logger", () => {
  it("returns WARNING with STDIO_UNEXPECTED_OUTPUT finding", async () => {
    const report = await runStdioCheck({ command: fixture("stdout-logger.mjs") });
    expect(report.overallStatus).toBe("WARNING");
    const finding = report.findings.find((f) => f.code === "STDIO_UNEXPECTED_OUTPUT");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("WARNING");
    expect(finding?.context?.["count"]).toBeGreaterThan(0);
  });

  it("still reports tools despite non-JSON stdout output", async () => {
    const report = await runStdioCheck({ command: fixture("stdout-logger.mjs") });
    expect(report.tools.length).toBeGreaterThan(0);
  });
});

describe("malformed-output", () => {
  it("returns FAIL with STDIO_FRAMING_ERROR or INIT_FAILURE", async () => {
    const report = await runStdioCheck(
      { command: fixture("malformed-output.mjs") },
      { startupTimeoutMs: 5000 },
    );
    expect(report.overallStatus).toBe("FAIL");
    const hasFramingError = report.findings.some((f) => f.code === "STDIO_FRAMING_ERROR");
    const hasInitFailure = report.findings.some((f) => f.code === "INIT_FAILURE");
    expect(hasFramingError || hasInitFailure).toBe(true);
  });
});

describe("startup-timeout", () => {
  it(
    "returns FAIL with TIMEOUT finding",
    async () => {
      const report = await runStdioCheck(
        { command: fixture("startup-timeout.mjs") },
        { startupTimeoutMs: 2000 },
      );
      expect(report.overallStatus).toBe("FAIL");
      expect(report.findings.some((f) => f.code === "TIMEOUT")).toBe(true);
    },
    // Give the test 8s: 2s startup timeout + shutdown sequence
    8000,
  );
});

describe("oversized-response", () => {
  it("returns FAIL with STDIO_RESPONSE_SIZE_EXCEEDED finding", async () => {
    const report = await runStdioCheck(
      { command: fixture("oversized-response.mjs") },
      {
        // Set a small limit (1 KB) — the fixture writes ~2 KB
        maxResponseSizeBytes: 1024,
        startupTimeoutMs: 5000,
      },
    );
    expect(report.overallStatus).toBe("FAIL");
    expect(
      report.findings.some((f) => f.code === "STDIO_RESPONSE_SIZE_EXCEEDED"),
    ).toBe(true);
  });
});

describe("invalid-schema", () => {
  it("returns FAIL with TOOL_INVALID_INPUT_SCHEMA finding", async () => {
    const report = await runStdioCheck({ command: fixture("invalid-schema.mjs") });
    expect(report.overallStatus).toBe("FAIL");
    const hasSchemaError = report.tools.some((t) =>
      t.findings.some((f) => f.code === "TOOL_INVALID_INPUT_SCHEMA"),
    );
    expect(hasSchemaError).toBe(true);
  });

  it("reports INIT_OK (server initializes correctly)", async () => {
    const report = await runStdioCheck({ command: fixture("invalid-schema.mjs") });
    expect(report.findings.some((f) => f.code === "INIT_OK")).toBe(true);
  });
});

describe("unclean-shutdown", () => {
  it(
    "returns WARNING with STDIO_SHUTDOWN_TIMEOUT after SIGKILL",
    async () => {
      const report = await runStdioCheck(
        { command: fixture("unclean-shutdown.mjs") },
        {
          shutdownTimeoutMs: 500,  // Short timeout to keep test fast
          startupTimeoutMs: 5000,
        },
      );
      // Server validates correctly — overallStatus is WARNING (not FAIL)
      expect(report.overallStatus).toBe("WARNING");
      expect(report.findings.some((f) => f.code === "STDIO_SHUTDOWN_TIMEOUT")).toBe(true);
      // But MCP init and tools still succeeded
      expect(report.findings.some((f) => f.code === "INIT_OK")).toBe(true);
      expect(report.tools.length).toBeGreaterThan(0);
    },
    // Give the test 12s: startup + 500ms timeout + 2s SIGTERM + 1s SIGKILL
    12000,
  );
});
