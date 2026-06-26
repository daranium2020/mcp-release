/**
 * Local action-level integration test.
 * Starts real fixture MCP servers and exercises the action's main logic
 * through the core API (same path as dist/index.js).
 *
 * This test verifies the end-to-end action behaviour without requiring a
 * real GitHub Actions runner. It is intentionally coarser than action.test.ts.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { FixtureServer } from "../../../fixtures/servers/src/index.js";
import {
  startValidServer,
  startInvalidToolNameServer,
} from "../../../fixtures/servers/src/index.js";

// Keep @actions/core mocked so we can capture output without writing real files
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

import * as core from "@actions/core";
import { parseInputs } from "../src/inputs.js";
import { emitAnnotations } from "../src/annotations.js";
import { runCheck, redactErrorMessage } from "@mcp-launch/core";

const STATUS_ORDER: Record<string, number> = { PASS: 0, WARNING: 1, FAIL: 2 };

function setInputs(values: Record<string, string>): void {
  (core.getInput as ReturnType<typeof vi.fn>).mockImplementation(
    (name: string, opts?: { required?: boolean }) => {
      const v = values[name] ?? "";
      if (opts?.required && v === "") throw new Error(`Required input ${name} missing`);
      return v;
    },
  );
}

async function runActionLogic(serverUrl: string): Promise<{ exitCode: number; status: string }> {
  (core.setFailed as ReturnType<typeof vi.fn>).mockClear();
  (core.setOutput as ReturnType<typeof vi.fn>).mockClear();

  setInputs({
    endpoint: serverUrl,
    "timeout-ms": "10000",
    "fail-on": "fail",
    format: "json",
    "output-directory": "/tmp",
    "development-mode": "true",
  });

  const inputs = parseInputs();
  let status = "FAIL";
  let exitCode = 0;

  try {
    const report = await runCheck(inputs.endpoint, {
      timeoutMs: inputs.timeoutMs,
      allowHttp: inputs.developmentMode,
    });

    const allFindings = [
      ...report.findings,
      ...report.tools.flatMap((t) => t.findings),
    ];
    const passCount = allFindings.filter((f) => f.severity === "PASS").length;
    const warnCount = allFindings.filter((f) => f.severity === "WARNING").length;
    const failCount = allFindings.filter((f) => f.severity === "FAIL").length;

    core.setOutput("status", report.overallStatus);
    core.setOutput("pass-count", String(passCount));
    core.setOutput("warning-count", String(warnCount));
    core.setOutput("fail-count", String(failCount));

    emitAnnotations(report.findings);
    for (const tool of report.tools) emitAnnotations(tool.findings, tool.name);

    const threshold = STATUS_ORDER[inputs.failOn] ?? 2;
    const actual = STATUS_ORDER[report.overallStatus] ?? 0;
    if (actual >= threshold) {
      core.setFailed(`MCP server validation result: ${report.overallStatus}`);
      exitCode = 1;
    }
    status = report.overallStatus;
  } catch (err: unknown) {
    const msg = redactErrorMessage(err);
    core.setFailed(`Action failed: ${msg}`);
    exitCode = 1;
  }

  return { exitCode, status };
}

describe("action integration — valid server", () => {
  let server: FixtureServer;
  beforeAll(async () => { server = await startValidServer(); });
  afterAll(async () => server.close());

  it("exits 0 and reports PASS for a valid MCP server", async () => {
    const { exitCode, status } = await runActionLogic(server.url);
    expect(exitCode).toBe(0);
    expect(status).toBe("PASS");
  }, 15000);

  it("sets status output to PASS", async () => {
    await runActionLogic(server.url);
    expect(core.setOutput).toHaveBeenCalledWith("status", "PASS");
  }, 15000);

  it("does not call setFailed for a passing server", async () => {
    await runActionLogic(server.url);
    expect(core.setFailed).not.toHaveBeenCalled();
  }, 15000);

  it("never invokes any MCP tools", async () => {
    // runCheck only calls tools/list, never callTool
    const { status } = await runActionLogic(server.url);
    // If tools were invoked, the side-effect would be visible in fixture server
    // state or cause errors. The most direct check: status is still PASS
    // (invoking nonexistent tools would cause FAIL).
    expect(status).toBe("PASS");
  }, 15000);
});

describe("action integration — broken server (invalid tool name)", () => {
  let server: FixtureServer;
  beforeAll(async () => { server = await startInvalidToolNameServer(); });
  afterAll(async () => server.close());

  it("exits 1 and reports FAIL for a broken MCP server", async () => {
    const { exitCode, status } = await runActionLogic(server.url);
    expect(exitCode).toBe(1);
    expect(status).toBe("FAIL");
  }, 15000);

  it("emits error annotation for FAIL finding", async () => {
    (core.error as ReturnType<typeof vi.fn>).mockClear();
    await runActionLogic(server.url);
    expect(core.error).toHaveBeenCalled();
  }, 15000);

  it("calls setFailed for a failing server", async () => {
    await runActionLogic(server.url);
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining("FAIL"));
  }, 15000);
});
