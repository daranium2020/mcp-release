import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startValidServer, startInvalidInputSchemaServer, startTimeoutServer, type FixtureServer } from "../../../fixtures/servers/src/index.js";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(__dirname, "../../cli/dist/index.js");

function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn("node", [cliPath, ...args], { stdio: "pipe" });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("close", (code) => resolve({ stdout, stderr, code }));
  });
}

describe("CLI — valid fixture", () => {
  let server: FixtureServer;
  beforeAll(async () => { server = await startValidServer(); });
  afterAll(async () => server.close());

  it("exits 0 and reports PASS", async () => {
    const { stdout, code } = await runCli(["check", server.url, "--allow-http", "--json"]);
    const report = JSON.parse(stdout) as { overallStatus: string; tools: unknown[]; findings: Array<{ code: string }> };
    expect(code).toBe(0);
    expect(report.overallStatus).toBe("PASS");
    expect(report.tools).toHaveLength(2);
    expect(report.findings.some((f) => f.code === "INIT_OK")).toBe(true);
    expect(report.findings.some((f) => f.code === "TOOLS_LIST_OK")).toBe(true);
  }, 15000);

  it("never invokes tools (no callTool in output)", async () => {
    const { stdout } = await runCli(["check", server.url, "--allow-http", "--json"]);
    expect(stdout).not.toContain("callTool");
    expect(stdout).not.toContain("tools/call");
    expect(stdout).not.toContain("TOOL_CALLED");
  }, 15000);
});

describe("CLI — invalid input schema fixture", () => {
  let server: FixtureServer;
  beforeAll(async () => { server = await startInvalidInputSchemaServer(); });
  afterAll(async () => server.close());

  it("exits 1 and reports FAIL", async () => {
    const { stdout, code } = await runCli(["check", server.url, "--allow-http", "--json"]);
    const report = JSON.parse(stdout) as { overallStatus: string; findings: Array<{ code: string }> };
    expect(code).toBe(1);
    expect(report.overallStatus).toBe("FAIL");
    const validFailCodes = ["TOOL_INVALID_INPUT_SCHEMA", "TOOLS_LIST_FAILURE"];
    expect(report.findings.some((f) => validFailCodes.includes(f.code))).toBe(true);
  }, 15000);
});

describe("CLI — timeout fixture", () => {
  let server: FixtureServer;
  beforeAll(async () => { server = await startTimeoutServer(); });
  afterAll(async () => server.close());

  it("exits 1 and reports FAIL with timeout finding", async () => {
    const { stdout, code } = await runCli([
      "check", server.url,
      "--allow-http",
      "--json",
      "--timeout-ms", "800",
    ]);
    const report = JSON.parse(stdout) as { overallStatus: string; findings: Array<{ code: string }> };
    expect(code).toBe(1);
    expect(report.overallStatus).toBe("FAIL");
    // HTTP localhost: TCP connects instantly → tcpConnected=true → outer timer
    // fires "Response timeout" → RESPONSE_TIMEOUT (not CONNECT_TIMEOUT).
    expect(report.findings.some((f) => f.code === "RESPONSE_TIMEOUT")).toBe(true);
  }, 15000);
});
