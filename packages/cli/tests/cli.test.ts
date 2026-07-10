/**
 * CLI integration tests.
 *
 * These tests spawn the compiled CLI binary (packages/cli/dist/index.js) and
 * verify behavior end-to-end. They require `pnpm build` to have run first —
 * the CI pipeline ensures this (build step precedes test step).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  startValidServer,
  startAuthenticatedServer,
  startUnauthorizedServer,
  type FixtureServer,
} from "../../../fixtures/servers/src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(__dirname, "../../cli/dist/index.js");

type CliResult = { stdout: string; stderr: string; code: number | null };

function runCli(
  args: string[],
  env?: Record<string, string>,
): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn("node", [cliPath, ...args], {
      stdio: "pipe",
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("close", (code) => resolve({ stdout, stderr, code }));
  });
}

// ---------------------------------------------------------------------------
// 1. Help and version
// ---------------------------------------------------------------------------

describe("CLI — help and version", () => {
  it("--help exits 0 and contains usage text", async () => {
    const { stdout, code } = await runCli(["--help"]);
    expect(code).toBe(0);
    expect(stdout).toContain("mcp-release");
    expect(stdout).toContain("check");
  });

  it("check --help exits 0 and mentions auth flags", async () => {
    const { stdout, code } = await runCli(["check", "--help"]);
    expect(code).toBe(0);
    expect(stdout).toContain("--header");
    expect(stdout).toContain("--bearer-token-env");
    expect(stdout).toContain("--json");
    expect(stdout).toContain("--out");
  });

  it("--version exits 0 and prints a semver-like version", async () => {
    const { stdout, code } = await runCli(["--version"]);
    expect(code).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

// ---------------------------------------------------------------------------
// 2. Public (valid) server — output format flags
// ---------------------------------------------------------------------------

describe("CLI — JSON output (--json)", () => {
  let server: FixtureServer;
  beforeAll(async () => { server = await startValidServer(); });
  afterAll(async () => server.close());

  it("--json produces parseable JSON and exits 0", async () => {
    const { stdout, code } = await runCli(["check", server.url, "--allow-http", "--json"]);
    expect(code).toBe(0);
    const report = JSON.parse(stdout) as {
      overallStatus: string;
      tools: Array<{ name: string }>;
      schemaVersion: string;
    };
    expect(report.overallStatus).toBe("PASS");
    expect(report.schemaVersion).toBe("1");
    expect(report.tools).toHaveLength(2);
  }, 15000);
});

describe("CLI — Markdown output (--markdown)", () => {
  let server: FixtureServer;
  beforeAll(async () => { server = await startValidServer(); });
  afterAll(async () => server.close());

  it("--markdown produces Markdown text and exits 0", async () => {
    const { stdout, code } = await runCli(["check", server.url, "--allow-http", "--markdown"]);
    expect(code).toBe(0);
    expect(stdout).toContain("PASS");
    expect(stdout).toMatch(/#+/); // has at least one heading
  }, 15000);
});

// ---------------------------------------------------------------------------
// 3. --out writes report to file
// ---------------------------------------------------------------------------

describe("CLI — --out writes report to a file", () => {
  let server: FixtureServer;
  let tmpDir: string;

  beforeAll(async () => {
    server = await startValidServer();
    tmpDir = mkdtempSync(join(tmpdir(), "mcp-cli-test-"));
  });
  afterAll(async () => {
    await server.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes JSON to the specified path", async () => {
    const outPath = join(tmpDir, "report.json");
    const { code } = await runCli([
      "check", server.url,
      "--allow-http",
      "--out", outPath,
    ]);
    expect(code).toBe(0);
    expect(existsSync(outPath)).toBe(true);
    const content = JSON.parse(readFileSync(outPath, "utf8")) as { overallStatus: string };
    expect(content.overallStatus).toBe("PASS");
  }, 15000);

  it("writes Markdown to the file when --markdown is set", async () => {
    const outPath = join(tmpDir, "report.md");
    const { code } = await runCli([
      "check", server.url,
      "--allow-http",
      "--markdown",
      "--out", outPath,
    ]);
    expect(code).toBe(0);
    expect(existsSync(outPath)).toBe(true);
    const content = readFileSync(outPath, "utf8");
    expect(content).toContain("PASS");
    expect(content).toMatch(/#+/);
  }, 15000);
});

// ---------------------------------------------------------------------------
// 4. Auth flags
// ---------------------------------------------------------------------------

describe("CLI — --bearer-token-env authentication", () => {
  let authServer: FixtureServer;
  const TOKEN = "cli-test-token-xyz789";

  beforeAll(async () => { authServer = await startAuthenticatedServer(TOKEN); });
  afterAll(async () => authServer.close());

  it("exits 0 (PASS) when correct bearer token is set in env", async () => {
    const { stdout, code } = await runCli(
      ["check", authServer.url, "--allow-http", "--json", "--bearer-token-env", "MCP_TOKEN"],
      { MCP_TOKEN: TOKEN },
    );
    expect(code).toBe(0);
    const report = JSON.parse(stdout) as { overallStatus: string };
    expect(report.overallStatus).toBe("PASS");
  }, 15000);

  it("exits 0 (WARNING) without token — AUTH_REQUIRED finding", async () => {
    const { stdout, code } = await runCli(["check", authServer.url, "--allow-http", "--json"]);
    // AUTH_REQUIRED is WARNING, which exits 0 without --fail-on-warning
    expect(code).toBe(0);
    const report = JSON.parse(stdout) as {
      overallStatus: string;
      findings: Array<{ code: string }>;
    };
    expect(report.overallStatus).toBe("WARNING");
    expect(report.findings.some((f) => f.code === "AUTH_REQUIRED")).toBe(true);
  }, 15000);

  it("exits 2 when env var referenced by --bearer-token-env is not set", async () => {
    const { stderr, code } = await runCli([
      "check", authServer.url,
      "--allow-http",
      "--bearer-token-env", "UNSET_TOKEN_VAR",
    ]);
    expect(code).toBe(2);
    expect(stderr).toContain("UNSET_TOKEN_VAR");
    expect(stderr).not.toContain(TOKEN); // token value must not appear
  }, 15000);

  it("never prints the bearer token value to stdout", async () => {
    const { stdout } = await runCli(
      ["check", authServer.url, "--allow-http", "--json", "--bearer-token-env", "MCP_TOKEN"],
      { MCP_TOKEN: TOKEN },
    );
    expect(stdout).not.toContain(TOKEN);
  }, 15000);

  it("never prints the bearer token value to stderr", async () => {
    const { stderr } = await runCli(
      ["check", authServer.url, "--allow-http", "--json", "--bearer-token-env", "MCP_TOKEN"],
      { MCP_TOKEN: TOKEN },
    );
    expect(stderr).not.toContain(TOKEN);
  }, 15000);
});

describe("CLI — --header authentication", () => {
  let authServer: FixtureServer;
  const TOKEN = "literal-header-token-abc";

  beforeAll(async () => { authServer = await startAuthenticatedServer(TOKEN); });
  afterAll(async () => authServer.close());

  it("exits 0 (PASS) with correct --header Authorization value", async () => {
    const { stdout, code } = await runCli([
      "check", authServer.url,
      "--allow-http",
      "--json",
      "--header", `Authorization: Bearer ${TOKEN}`,
    ]);
    expect(code).toBe(0);
    const report = JSON.parse(stdout) as { overallStatus: string };
    expect(report.overallStatus).toBe("PASS");
  }, 15000);
});

// ---------------------------------------------------------------------------
// 5. --fail-on-warning exit code
// ---------------------------------------------------------------------------

describe("CLI — --fail-on-warning exit code", () => {
  let authServer: FixtureServer;
  beforeAll(async () => { authServer = await startAuthenticatedServer("any-token"); });
  afterAll(async () => authServer.close());

  it("exits 4 (WARNING with --fail-on-warning) for AUTH_REQUIRED finding", async () => {
    const { code } = await runCli([
      "check", authServer.url,
      "--allow-http",
      "--fail-on-warning",
    ]);
    // AUTH_REQUIRED → WARNING → exit 4 when --fail-on-warning is set
    expect(code).toBe(4);
  }, 15000);

  it("exits 0 (WARNING without --fail-on-warning) for AUTH_REQUIRED finding", async () => {
    const { code } = await runCli(["check", authServer.url, "--allow-http"]);
    expect(code).toBe(0);
  }, 15000);
});

// ---------------------------------------------------------------------------
// 6. Sensitive values not printed
// ---------------------------------------------------------------------------

describe("CLI — sensitive values are not printed", () => {
  let unauthServer: FixtureServer;
  beforeAll(async () => { unauthServer = await startUnauthorizedServer(); });
  afterAll(async () => unauthServer.close());

  it("does not print literal Authorization header value to stdout", async () => {
    const sensitiveValue = "Bearer super-secret-literal-value";
    const { stdout } = await runCli([
      "check", unauthServer.url,
      "--allow-http",
      "--json",
      "--header", `Authorization: ${sensitiveValue}`,
    ]);
    expect(stdout).not.toContain("super-secret-literal-value");
  }, 15000);
});
