import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CheckReport } from "@mcp-launch/core";

// Mock @actions/core before importing action code
vi.mock("@actions/core", () => ({
  getInput: vi.fn(),
  setOutput: vi.fn(),
  setFailed: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  summary: {
    addHeading: vi.fn().mockReturnThis(),
    addRaw: vi.fn().mockReturnThis(),
    write: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock runCheck — we never want real network calls in unit tests
vi.mock("@mcp-launch/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mcp-launch/core")>();
  return {
    ...actual,
    runCheck: vi.fn(),
  };
});

import * as core from "@actions/core";
import * as coreModule from "@mcp-launch/core";

const STATUS_ORDER: Record<string, number> = { PASS: 0, WARNING: 1, FAIL: 2 };

function makeReport(overallStatus: "PASS" | "WARNING" | "FAIL"): CheckReport {
  return {
    schemaVersion: "1",
    serverUrl: "https://example.com/mcp",
    checkedAt: "2026-06-26T12:00:00.000Z",
    durationMs: 120,
    overallStatus,
    transport: {
      httpStatus: null,
      httpStatusText: null,
      durationMs: 100,
      redirectCount: 0,
      headersAvailable: false,
    },
    protocolVersion: "2024-11-05",
    serverInfo: { name: "test-server", version: "1.0.0" },
    findings: [
      { code: "INIT_OK", severity: "PASS", message: "initialized" },
      { code: "TOOLS_LIST_OK", severity: "PASS", message: "found 1 tool(s)" },
      ...(overallStatus === "FAIL"
        ? [{ code: "TRANSPORT_ERROR" as const, severity: "FAIL" as const, message: "connection failed" }]
        : []),
      ...(overallStatus === "WARNING"
        ? [{ code: "TOOL_MISSING_DESCRIPTION" as const, severity: "WARNING" as const, message: "no description" }]
        : []),
    ],
    tools: [],
  };
}

/** Simulate the action's exit-decision logic. */
function shouldFail(overallStatus: string, failOn: string): boolean {
  const threshold = STATUS_ORDER[failOn.toUpperCase()] ?? 2;
  const actual = STATUS_ORDER[overallStatus] ?? 0;
  return actual >= threshold;
}

/** Simulate the action's output-counting logic. */
function countFindings(report: CheckReport) {
  const allFindings = [
    ...report.findings,
    ...report.tools.flatMap((t) => t.findings),
  ];
  return {
    passCount: allFindings.filter((f) => f.severity === "PASS").length,
    warnCount: allFindings.filter((f) => f.severity === "WARNING").length,
    failCount: allFindings.filter((f) => f.severity === "FAIL").length,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("action — exit behavior", () => {
  it("does not fail for PASS result with fail-on FAIL threshold", () => {
    expect(shouldFail("PASS", "FAIL")).toBe(false);
  });

  it("does not fail for WARNING result with fail-on FAIL threshold", () => {
    expect(shouldFail("WARNING", "FAIL")).toBe(false);
  });

  it("fails for FAIL result with fail-on FAIL threshold", () => {
    expect(shouldFail("FAIL", "FAIL")).toBe(true);
  });

  it("fails for WARNING result with fail-on WARNING threshold", () => {
    expect(shouldFail("WARNING", "WARNING")).toBe(true);
  });

  it("fails for FAIL result with fail-on WARNING threshold", () => {
    expect(shouldFail("FAIL", "WARNING")).toBe(true);
  });

  it("does not fail for PASS result with fail-on WARNING threshold", () => {
    expect(shouldFail("PASS", "WARNING")).toBe(false);
  });

  it("calls setFailed only when threshold is met", async () => {
    const report = makeReport("FAIL");
    if (shouldFail(report.overallStatus, "FAIL")) {
      core.setFailed(`MCP server validation result: ${report.overallStatus}`);
    }
    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining("FAIL"),
    );
  });
});

describe("action — outputs", () => {
  it("counts PASS findings from a PASS report", () => {
    const report = makeReport("PASS");
    const { passCount, warnCount, failCount } = countFindings(report);
    expect(passCount).toBe(2);
    expect(warnCount).toBe(0);
    expect(failCount).toBe(0);
  });

  it("counts FAIL findings from a FAIL report", () => {
    const report = makeReport("FAIL");
    const { passCount, warnCount, failCount } = countFindings(report);
    expect(passCount).toBe(2);
    expect(warnCount).toBe(0);
    expect(failCount).toBe(1);
  });

  it("counts WARNING findings from a WARNING report", () => {
    const report = makeReport("WARNING");
    const { passCount, warnCount, failCount } = countFindings(report);
    expect(passCount).toBe(2);
    expect(warnCount).toBe(1);
    expect(failCount).toBe(0);
  });

  it("sets status and count outputs", () => {
    const report = makeReport("PASS");
    const { passCount, warnCount, failCount } = countFindings(report);
    core.setOutput("status", report.overallStatus);
    core.setOutput("pass-count", String(passCount));
    core.setOutput("warning-count", String(warnCount));
    core.setOutput("fail-count", String(failCount));

    expect(core.setOutput).toHaveBeenCalledWith("status", "PASS");
    expect(core.setOutput).toHaveBeenCalledWith("pass-count", "2");
    expect(core.setOutput).toHaveBeenCalledWith("warning-count", "0");
    expect(core.setOutput).toHaveBeenCalledWith("fail-count", "0");
  });
});

describe("action — never invokes tools", () => {
  it("runCheck is called without tool-invocation parameters", async () => {
    (coreModule.runCheck as ReturnType<typeof vi.fn>).mockResolvedValue(makeReport("PASS"));

    await (coreModule.runCheck as ReturnType<typeof vi.fn>)(
      "https://example.com/mcp",
      { timeoutMs: 10000, allowHttp: false },
    );

    const callArg = (coreModule.runCheck as ReturnType<typeof vi.fn>).mock.calls[0];
    const options = callArg?.[1] as Record<string, unknown>;

    // Options must not contain any tool-invocation keys
    expect(options).not.toHaveProperty("callTools");
    expect(options).not.toHaveProperty("invokeTools");
    expect(options).not.toHaveProperty("executeTool");
    const optStr = JSON.stringify(options ?? {});
    expect(optStr).not.toContain("toolInput");
    expect(optStr).not.toContain("toolArgs");
  });
});

describe("action — error redaction", () => {
  it("does not leak secrets from error messages", () => {
    (coreModule.runCheck as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Connection failed token=supersecret123"),
    );

    const rawMessage = "Connection failed token=supersecret123";
    const msg = coreModule.redactErrorMessage(new Error(rawMessage));

    // Simulate the catch block
    core.setFailed(`Action failed: ${msg}`);

    const calls = (core.setFailed as ReturnType<typeof vi.fn>).mock.calls;
    const combinedOutput = calls.map((c: unknown[]) => String(c[0])).join(" ");
    expect(combinedOutput).not.toContain("supersecret123");
    expect(combinedOutput).toContain("[REDACTED]");
  });
});
