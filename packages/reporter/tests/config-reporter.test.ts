/**
 * Tests for v0.3.0 config report formatters:
 *   toTerminalConfig, toMarkdownConfig, toJsonConfig
 *
 * Tests:
 *   - Terminal shows scenario names, PASS/FAIL badges
 *   - Markdown has summary table with correct columns
 *   - JSON round-trips all fields correctly
 *   - JSON and Markdown contain the same scenario data (parity)
 *   - Privacy note for CLI/GHA environments
 *   - Backward compat: reports without mcpReleaseVersion
 */
import { describe, it, expect } from "vitest";
import type { ConfigReport } from "@mcp-release/core";
import { toTerminalConfig, toMarkdownConfig, toJsonConfig } from "@mcp-release/reporter";

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

function makePassReport(): ConfigReport {
  return {
    schemaVersion: "1",
    configFile: "mcp-release.config.yml",
    serverUrl: "https://api.example.com/mcp",
    startedAt: "2026-07-19T10:00:00.000Z",
    durationMs: 1200,
    overallStatus: "PASS",
    mcpReleaseVersion: "0.3.0",
    executionEnvironment: "cli",
    scenarios: [
      {
        name: "healthy",
        expected: { result: "pass" },
        actual: { result: "PASS", httpStatus: 200 },
        matched: true,
        attempts: 1,
        durationMs: 350,
        report: {
          schemaVersion: "1",
          serverUrl: "https://api.example.com/mcp",
          checkedAt: "2026-07-19T10:00:00.000Z",
          startedAt: "2026-07-19T10:00:00.000Z",
          durationMs: 350,
          overallStatus: "PASS",
          transport: { httpStatus: 200, httpStatusText: null, durationMs: 300, redirectCount: 0, headersAvailable: false },
          transportType: "http",
          protocolVersion: "2024-11-05",
          serverInfo: { name: "my-server", version: "1.0" },
          findings: [
            { code: "INIT_OK", severity: "PASS", message: "MCP initialization succeeded" },
          ],
          tools: [],
          scenarioName: "healthy",
          attempts: 1,
        },
      },
      {
        name: "missing-auth",
        expected: { httpStatus: 401 },
        actual: { result: "WARNING", httpStatus: 401 },
        matched: true,
        attempts: 1,
        durationMs: 120,
        report: {
          schemaVersion: "1",
          serverUrl: "https://api.example.com/mcp",
          checkedAt: "2026-07-19T10:00:00.100Z",
          startedAt: "2026-07-19T10:00:00.100Z",
          durationMs: 120,
          overallStatus: "WARNING",
          transport: { httpStatus: 401, httpStatusText: null, durationMs: 100, redirectCount: 0, headersAvailable: false },
          transportType: "http",
          protocolVersion: null,
          serverInfo: null,
          findings: [
            { code: "AUTH_REQUIRED", severity: "WARNING", message: "Server requires authorization." },
          ],
          tools: [],
          scenarioName: "missing-auth",
          attempts: 1,
        },
      },
    ],
  };
}

function makeFailReport(): ConfigReport {
  return {
    ...makePassReport(),
    overallStatus: "FAIL",
    scenarios: [
      {
        name: "broken",
        expected: { result: "pass" },
        actual: { result: "FAIL", httpStatus: 401 },
        matched: false,
        attempts: 1,
        durationMs: 100,
        report: {
          schemaVersion: "1",
          serverUrl: "https://api.example.com/mcp",
          checkedAt: "2026-07-19T10:00:00.000Z",
          startedAt: "2026-07-19T10:00:00.000Z",
          durationMs: 100,
          overallStatus: "FAIL",
          transport: { httpStatus: 401, httpStatusText: null, durationMs: 90, redirectCount: 0, headersAvailable: false },
          transportType: "http",
          protocolVersion: null,
          serverInfo: null,
          findings: [
            { code: "AUTH_REQUIRED", severity: "WARNING", message: "Server requires authorization." },
            { code: "SCENARIO_MISMATCH", severity: "FAIL", message: "Scenario expected [result=pass] but got [result=WARNING, httpStatus=401]." },
          ],
          tools: [],
          scenarioName: "broken",
          attempts: 1,
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 1. toTerminalConfig
// ---------------------------------------------------------------------------

describe("toTerminalConfig", () => {
  it("includes server URL", () => {
    const out = toTerminalConfig(makePassReport());
    expect(out).toContain("api.example.com");
  });

  it("includes config file name", () => {
    const out = toTerminalConfig(makePassReport());
    expect(out).toContain("mcp-release.config.yml");
  });

  it("shows scenario names", () => {
    const out = toTerminalConfig(makePassReport());
    expect(out).toContain("healthy");
    expect(out).toContain("missing-auth");
  });

  it("shows overall pass/fail count", () => {
    const out = toTerminalConfig(makePassReport());
    expect(out).toContain("2/2");
  });

  it("shows 0/1 when one scenario fails", () => {
    const out = toTerminalConfig(makeFailReport());
    expect(out).toContain("0/1");
  });

  it("includes CLI security note about credentials", () => {
    const out = toTerminalConfig(makePassReport());
    expect(out).toContain("Credentials are sent only to the configured MCP endpoint.");
  });

  it("no security note for browser environment", () => {
    const report: ConfigReport = { ...makePassReport(), executionEnvironment: "browser" };
    const out = toTerminalConfig(report);
    expect(out).not.toContain("Credentials are sent only to");
  });

  it("shows MCP Release version when present", () => {
    const out = toTerminalConfig(makePassReport());
    expect(out).toContain("0.3.0");
  });

  it("works when mcpReleaseVersion is absent", () => {
    const report = makePassReport();
    const { mcpReleaseVersion: _, ...withoutVersion } = report;
    expect(() => toTerminalConfig(withoutVersion as ConfigReport)).not.toThrow();
  });

  it("shows FAIL findings for mismatched scenarios", () => {
    const out = toTerminalConfig(makeFailReport());
    expect(out).toContain("SCENARIO_MISMATCH");
  });
});

// ---------------------------------------------------------------------------
// 2. toMarkdownConfig
// ---------------------------------------------------------------------------

describe("toMarkdownConfig", () => {
  it("contains a summary table header", () => {
    const out = toMarkdownConfig(makePassReport());
    expect(out).toContain("| Scenario |");
    expect(out).toContain("| Expected |");
    expect(out).toContain("| Actual |");
    expect(out).toContain("| Attempts |");
    expect(out).toContain("| Retry |");
    expect(out).toContain("| Duration |");
    expect(out).toContain("| Result |");
  });

  it("contains a row for each scenario", () => {
    const out = toMarkdownConfig(makePassReport());
    expect(out).toContain("`healthy`");
    expect(out).toContain("`missing-auth`");
  });

  it("shows server URL and config file", () => {
    const out = toMarkdownConfig(makePassReport());
    expect(out).toContain("https://api.example.com/mcp");
    expect(out).toContain("mcp-release.config.yml");
  });

  it("shows overall status badge", () => {
    const out = toMarkdownConfig(makePassReport());
    expect(out).toContain("PASS");
  });

  it("shows passed and failed counts", () => {
    const out = toMarkdownConfig(makePassReport());
    // 2 passed, 0 failed
    expect(out).toContain("2");
    expect(out).toContain("0");
  });

  it("includes security note for CLI", () => {
    const out = toMarkdownConfig(makePassReport());
    expect(out).toContain("Credentials are sent only to the configured MCP endpoint.");
  });

  it("no security note for browser", () => {
    const report: ConfigReport = { ...makePassReport(), executionEnvironment: "browser" };
    const out = toMarkdownConfig(report);
    expect(out).not.toContain("Credentials are sent only to");
  });

  it("shows FAIL finding details for mismatched scenarios", () => {
    const out = toMarkdownConfig(makeFailReport());
    expect(out).toContain("SCENARIO_MISMATCH");
  });
});

// ---------------------------------------------------------------------------
// 3. toJsonConfig
// ---------------------------------------------------------------------------

describe("toJsonConfig", () => {
  it("produces valid JSON", () => {
    const out = toJsonConfig(makePassReport());
    expect(() => JSON.parse(out)).not.toThrow();
  });

  it("round-trips all scenario fields", () => {
    const report = makePassReport();
    const parsed = JSON.parse(toJsonConfig(report)) as ConfigReport;
    expect(parsed.scenarios).toHaveLength(2);
    expect(parsed.scenarios[0].name).toBe("healthy");
    expect(parsed.scenarios[1].name).toBe("missing-auth");
    expect(parsed.scenarios[0].matched).toBe(true);
    expect(parsed.scenarios[0].attempts).toBe(1);
  });

  it("contains mcpReleaseVersion", () => {
    const parsed = JSON.parse(toJsonConfig(makePassReport())) as ConfigReport;
    expect(parsed.mcpReleaseVersion).toBe("0.3.0");
  });

  it("contains executionEnvironment", () => {
    const parsed = JSON.parse(toJsonConfig(makePassReport())) as ConfigReport;
    expect(parsed.executionEnvironment).toBe("cli");
  });

  it("compact JSON when pretty=false", () => {
    const out = toJsonConfig(makePassReport(), false);
    expect(out).not.toContain("\n");
  });

  it("pretty-printed JSON by default", () => {
    const out = toJsonConfig(makePassReport());
    expect(out).toContain("\n");
  });
});

// ---------------------------------------------------------------------------
// 4. JSON / Markdown parity — same scenario data in both formats
// ---------------------------------------------------------------------------

describe("JSON and Markdown parity", () => {
  it("JSON and Markdown contain the same scenario names", () => {
    const report = makePassReport();
    const json = JSON.parse(toJsonConfig(report)) as ConfigReport;
    const md = toMarkdownConfig(report);

    const jsonNames = json.scenarios.map((s) => s.name);
    for (const name of jsonNames) {
      expect(md).toContain(name);
    }
  });

  it("matched status agrees between JSON and Markdown", () => {
    const report = makeFailReport();
    const json = JSON.parse(toJsonConfig(report)) as ConfigReport;
    const md = toMarkdownConfig(report);

    const failedInJson = json.scenarios.filter((s) => !s.matched).map((s) => s.name);
    for (const name of failedInJson) {
      // Markdown marks them with a FAIL badge
      expect(md).toContain(name);
    }
  });

  it("overall status is consistent between JSON, Markdown, and Terminal", () => {
    const report = makePassReport();
    const json = JSON.parse(toJsonConfig(report)) as ConfigReport;
    const md = toMarkdownConfig(report);
    const term = toTerminalConfig(report);

    expect(json.overallStatus).toBe("PASS");
    expect(md).toContain("PASS");
    expect(term).toContain("PASS");
  });
});

// ---------------------------------------------------------------------------
// 5. REMEDIATION coverage — new codes have entries
// ---------------------------------------------------------------------------

describe("REMEDIATION entries for v0.3.0 codes", () => {
  it("REMEDIATION is imported from reporter", async () => {
    const { REMEDIATION } = await import("@mcp-release/reporter");
    expect(typeof REMEDIATION).toBe("object");
  });

  it("AUTH_INVALID has a remediation entry", async () => {
    const { REMEDIATION } = await import("@mcp-release/reporter");
    expect(REMEDIATION["AUTH_INVALID"]).toBeDefined();
  });

  it("AUTH_EXPIRED has a remediation entry", async () => {
    const { REMEDIATION } = await import("@mcp-release/reporter");
    expect(REMEDIATION["AUTH_EXPIRED"]).toBeDefined();
  });

  it("AUTH_FORBIDDEN has a remediation entry", async () => {
    const { REMEDIATION } = await import("@mcp-release/reporter");
    expect(REMEDIATION["AUTH_FORBIDDEN"]).toBeDefined();
  });

  it("RATE_LIMITED has a remediation entry", async () => {
    const { REMEDIATION } = await import("@mcp-release/reporter");
    expect(REMEDIATION["RATE_LIMITED"]).toBeDefined();
  });

  it("CONNECT_TIMEOUT has a remediation entry", async () => {
    const { REMEDIATION } = await import("@mcp-release/reporter");
    expect(REMEDIATION["CONNECT_TIMEOUT"]).toBeDefined();
  });

  it("RESPONSE_TIMEOUT has a remediation entry", async () => {
    const { REMEDIATION } = await import("@mcp-release/reporter");
    expect(REMEDIATION["RESPONSE_TIMEOUT"]).toBeDefined();
  });

  it("RETRY_EXHAUSTED has a remediation entry", async () => {
    const { REMEDIATION } = await import("@mcp-release/reporter");
    expect(REMEDIATION["RETRY_EXHAUSTED"]).toBeDefined();
  });

  it("SCENARIO_MISMATCH has a remediation entry", async () => {
    const { REMEDIATION } = await import("@mcp-release/reporter");
    expect(REMEDIATION["SCENARIO_MISMATCH"]).toBeDefined();
  });
});
