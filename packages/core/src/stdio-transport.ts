/**
 * Stdio transport for MCP servers that communicate via stdin/stdout.
 *
 * Implements the MCP Transport interface by spawning a child process and
 * communicating with it over its standard streams. Validates stdout content
 * line-by-line to detect protocol violations:
 *
 *   - Non-JSON lines on stdout are recorded as STDIO_UNEXPECTED_OUTPUT (WARNING).
 *     Logs must go to stderr. Non-JSON lines are not forwarded to the client.
 *
 *   - Lines that are valid JSON but fail the MCP JSONRPCMessageSchema are recorded
 *     as STDIO_FRAMING_ERROR (FAIL). The client is notified via onerror().
 *
 *   - Total stdout bytes are tracked; exceeding the limit kills the process and
 *     sets sizeLimitExceeded = true.
 *
 * After close(), forcedKill indicates whether the process required SIGTERM/SIGKILL
 * rather than exiting cleanly after stdin EOF.
 */

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessageSchema } from "@modelcontextprotocol/sdk/types.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

export type StdioTransportOptions = {
  cwd?: string;
  /** Inherited environment variables. Defaults to a safe subset of process.env. */
  env?: Record<string, string>;
  /** Bytes limit for total stdout received. Kills the process if exceeded. */
  maxResponseSizeBytes: number;
  /** How long to wait for graceful exit after stdin EOF before sending SIGTERM. */
  shutdownTimeoutMs: number;
};

/**
 * Split a shell-like command string into [executable, ...args].
 * Handles single-quoted and double-quoted segments. Backslash-escape inside
 * double quotes. Does NOT invoke a shell; no glob expansion or variable
 * substitution is performed.
 */
export function parseShellCommand(cmd: string): [string, string[]] {
  const tokens: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]!;
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (ch === "\\" && inDouble && i + 1 < cmd.length) {
      current += cmd[++i]!;
    } else if ((ch === " " || ch === "\t") && !inSingle && !inDouble) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) tokens.push(current);

  if (tokens.length === 0) throw new Error("Command must not be empty");
  const [executable, ...args] = tokens;
  return [executable!, args];
}

/** Safe subset of environment variables to inherit (mirrors MCP SDK defaults). */
const INHERITED_ENV_KEYS =
  process.platform === "win32"
    ? ["APPDATA", "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA", "PATH",
       "PROCESSOR_ARCHITECTURE", "SYSTEMDRIVE", "SYSTEMROOT", "TEMP",
       "USERNAME", "USERPROFILE"]
    : ["HOME", "LOGNAME", "PATH", "SHELL", "TERM", "USER", "TMPDIR",
       "npm_config_cache", "npm_execpath"];

function buildSafeEnv(override?: Record<string, string>): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = {};
  for (const key of INHERITED_ENV_KEYS) {
    const val = process.env[key];
    if (val !== undefined) env[key] = val;
  }
  if (override) Object.assign(env, override);
  return env as NodeJS.ProcessEnv;
}

/**
 * Maximum number of characters to keep from any single non-protocol line for
 * the finding context. Prevents large garbage output from bloating the report.
 */
const MAX_PREVIEW_CHARS = 200;

export class StdioValidatingTransport implements Transport {
  private _process: ChildProcess | undefined = undefined;

  // Validation state — readable after close()
  private _unexpectedLines: string[] = [];
  private _framingErrors: string[] = [];
  private _sizeLimitExceeded = false;
  private _forcedKill = false;
  private _processExitCode: number | null = null;

  /** Non-JSON lines received on stdout. Populated during the session. */
  get unexpectedLines(): readonly string[] { return this._unexpectedLines; }
  /** Valid-JSON lines that failed MCP JSONRPCMessageSchema. */
  get framingErrors(): readonly string[] { return this._framingErrors; }
  get sizeLimitExceeded(): boolean { return this._sizeLimitExceeded; }
  /** True when the process did not exit cleanly and required SIGTERM/SIGKILL. */
  get forcedKill(): boolean { return this._forcedKill; }
  /** Exit code of the child process, or null if it hasn't exited. */
  get processExitCode(): number | null { return this._processExitCode; }

  // MCP Transport callbacks
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  private readonly _opts: StdioTransportOptions;

  constructor(
    private readonly _executable: string,
    private readonly _args: string[],
    opts: StdioTransportOptions,
  ) {
    this._opts = opts;
  }

  async start(): Promise<void> {
    if (this._process) {
      throw new Error("StdioValidatingTransport already started");
    }

    return new Promise<void>((resolve, reject) => {
      // The spawn overloads for mixed stdio arrays ([pipe,pipe,inherit]) don't
      // resolve cleanly in strict TypeScript — cast through unknown to ChildProcess.
      const child = spawn(this._executable, this._args, {
        ...(this._opts.cwd !== undefined ? { cwd: this._opts.cwd } : {}),
        env: buildSafeEnv(this._opts.env),
        // stdin: pipe (we write to it), stdout: pipe (we read/validate it), stderr: inherit
        stdio: ["pipe", "pipe", "inherit"],
        shell: false,
      }) as unknown as ChildProcess;

      this._process = child;

      child.on("error", (err) => {
        this._process = undefined;
        reject(err);
        this.onerror?.(err);
      });

      child.on("spawn", () => {
        resolve();
      });

      child.on("close", (code) => {
        this._processExitCode = code;
        this._process = undefined;
        this.onclose?.();
      });

      child.stdin?.on("error", (err) => {
        // EPIPE is expected when the server closes stdin; ignore it silently.
        if ((err as NodeJS.ErrnoException).code !== "EPIPE") {
          this.onerror?.(err);
        }
      });

      // Stdout validation
      let buf = "";
      let totalBytes = 0;

      child.stdout?.on("data", (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > this._opts.maxResponseSizeBytes && !this._sizeLimitExceeded) {
          this._sizeLimitExceeded = true;
          const limit = this._opts.maxResponseSizeBytes;
          this.onerror?.(
            new Error(`Server stdout exceeded ${limit} bytes; process killed`),
          );
          try { child.kill("SIGTERM"); } catch { /* ignore */ }
          return;
        }
        if (this._sizeLimitExceeded) return;

        buf += chunk.toString("utf8");
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.replace(/\r$/, "");
          if (trimmed === "") continue;
          this._processLine(trimmed);
        }
      });

      child.stdout?.on("error", (err) => {
        this.onerror?.(err);
      });

      child.stdout?.on("close", () => {
        const remaining = buf.replace(/\r$/, "").trim();
        if (remaining.length > 0) this._processLine(remaining);
        buf = "";
      });
    });
  }

  private _processLine(line: string): void {
    // Try JSON parsing first
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Not valid JSON — record as unexpected stdout output (WARNING, not protocol error)
      this._unexpectedLines.push(line.slice(0, MAX_PREVIEW_CHARS));
      return;
    }

    // Valid JSON — try MCP schema
    const result = JSONRPCMessageSchema.safeParse(parsed);
    if (!result.success) {
      // Valid JSON but not a valid MCP message — protocol framing error
      this._framingErrors.push(line.slice(0, MAX_PREVIEW_CHARS));
      this.onerror?.(new Error("Server sent a malformed MCP protocol message on stdout"));
      return;
    }

    this.onmessage?.(result.data);
  }

  async send(message: JSONRPCMessage): Promise<void> {
    const proc = this._process;
    if (!proc?.stdin) {
      throw new Error("Transport is not connected");
    }
    const serialized = JSON.stringify(message) + "\n";
    await new Promise<void>((resolve, reject) => {
      const written = proc.stdin!.write(serialized, (err) => {
        if (err) reject(err);
      });
      if (written) resolve();
      else proc.stdin!.once("drain", resolve);
    });
  }

  async close(): Promise<void> {
    const proc = this._process;
    if (!proc) return;
    this._process = undefined;

    let exited = false;
    const exitPromise = new Promise<void>((resolve) => {
      if (proc.exitCode !== null) {
        exited = true;
        resolve();
        return;
      }
      proc.once("close", () => {
        exited = true;
        resolve();
      });
    });

    // Signal EOF to the server (graceful shutdown request)
    try { proc.stdin?.end(); } catch { /* ignore */ }

    // Wait for graceful exit
    await Promise.race([
      exitPromise,
      new Promise<void>((resolve) => setTimeout(resolve, this._opts.shutdownTimeoutMs)),
    ]);

    if (!exited) {
      this._forcedKill = true;
      // SIGTERM
      try { proc.kill("SIGTERM"); } catch { /* ignore */ }
      await Promise.race([
        exitPromise,
        new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
      ]);
      // SIGKILL if still alive
      if (!exited) {
        try { proc.kill("SIGKILL"); } catch { /* ignore */ }
        await Promise.race([
          exitPromise,
          new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
        ]);
      }
    }
  }
}
