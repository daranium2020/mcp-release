/**
 * Helper: start a fixture server, run CLI against it, print output.
 * Not a test file — run manually via vitest for CLI smoke testing.
 */
import { describe, it } from "vitest";
import { startValidServer, startInvalidToolNameServer } from "../../../fixtures/servers/src/index.js";
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

describe("CLI smoke tests", () => {
  it("valid server — terminal output", async () => {
    const server = await startValidServer();
    const { stdout, code } = await runCli(["check", server.url, "--env", "development", "--output", "terminal"]);
    console.log("EXIT CODE:", code);
    console.log("STDOUT:\n" + stdout);
    await server.close();
  }, 15000);

  it("valid server — json output", async () => {
    const server = await startValidServer();
    const { stdout, code } = await runCli(["check", server.url, "--env", "development", "--output", "json"]);
    console.log("EXIT CODE:", code);
    console.log("STDOUT (json):\n" + stdout.substring(0, 800));
    await server.close();
  }, 15000);

  it("broken server (invalid tool name) — terminal output", async () => {
    const server = await startInvalidToolNameServer();
    const { stdout, code } = await runCli(["check", server.url, "--env", "development", "--output", "terminal"]);
    console.log("BROKEN EXIT CODE:", code);
    console.log("BROKEN STDOUT:\n" + stdout);
    await server.close();
  }, 15000);
});
