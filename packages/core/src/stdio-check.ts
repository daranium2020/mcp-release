import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  type CheckReport,
  type Finding,
  type ToolReport,
  makeFinding,
  worstSeverity,
} from "./report.js";
import { listTools } from "./transport.js";
import { validateTools } from "./validator.js";
import { redactErrorMessage, redactString } from "./redact.js";
import {
  StdioValidatingTransport,
  parseShellCommand,
} from "./stdio-transport.js";

export type StdioCheckParams = {
  /** Full command string, e.g. "npx -y my-mcp-server" or "node ./dist/server.js" */
  command: string;
  /** Working directory for the spawned process. Defaults to current directory. */
  cwd?: string;
};

export type StdioCheckOptions = {
  /** Milliseconds to wait for MCP initialization before reporting TIMEOUT. Default: 15 000 */
  startupTimeoutMs?: number;
  /** Milliseconds after stdin EOF before SIGTERM is sent during shutdown. Default: 5 000 */
  shutdownTimeoutMs?: number;
  /** Maximum bytes allowed on stdout before the process is killed. Default: 10 MB */
  maxResponseSizeBytes?: number;
};

const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_RESPONSE_SIZE_BYTES = 10 * 1024 * 1024;

function safeCommandLabel(command: string): string {
  const first = command.trim().split(/\s+/)[0] ?? "unknown";
  return `stdio:${redactString(first)}`;
}

function buildReport(
  serverUrl: string,
  checkedAt: string,
  startMs: number,
  findings: Finding[],
  tools: ToolReport[],
  protocolVersion: string | null,
  serverInfo: { name?: string; version?: string } | null,
): CheckReport {
  const allFindings = [...findings, ...tools.flatMap((t) => t.findings)];
  return {
    schemaVersion: "1",
    serverUrl,
    checkedAt,
    durationMs: Date.now() - startMs,
    overallStatus: worstSeverity(allFindings),
    transport: null,
    protocolVersion,
    serverInfo,
    findings,
    tools,
  };
}

/**
 * Validate a local MCP server that communicates via stdio (stdin/stdout).
 *
 * Spawns the configured process, performs MCP initialization, lists tools,
 * validates tool schemas, then shuts the process down. No data is sent to
 * any remote MCP Release service — validation is entirely local.
 *
 * Security properties:
 *   - The command executes in the caller's environment (CLI or GitHub Actions runner).
 *   - Environment variables are passed through a safe allow-list; credentials
 *     must be injected via the workflow env block, not through action inputs.
 *   - Sensitive patterns in error messages are redacted before inclusion in findings.
 */
export async function runStdioCheck(
  params: StdioCheckParams,
  opts: StdioCheckOptions = {},
): Promise<CheckReport> {
  const startMs = Date.now();
  const checkedAt = new Date().toISOString();
  const label = safeCommandLabel(params.command);
  const findings: Finding[] = [];

  const startupTimeoutMs = opts.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  const shutdownTimeoutMs = opts.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
  const maxResponseSizeBytes = opts.maxResponseSizeBytes ?? DEFAULT_MAX_RESPONSE_SIZE_BYTES;

  // Parse command string into executable + args
  let executable: string;
  let args: string[];
  try {
    [executable, args] = parseShellCommand(params.command);
  } catch (err) {
    findings.push(
      makeFinding(
        "STDIO_PROCESS_ERROR",
        "FAIL",
        `Invalid command: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    return buildReport(label, checkedAt, startMs, findings, [], null, null);
  }

  const transport = new StdioValidatingTransport(executable, args, {
    ...(params.cwd !== undefined ? { cwd: params.cwd } : {}),
    maxResponseSizeBytes,
    shutdownTimeoutMs,
  });

  const client = new Client({ name: "mcp-release-checker", version: "0.0.1" });

  let connected = false;
  let protocolVersion: string | null = null;
  let serverInfo: { name?: string; version?: string } | null = null;
  let toolReports: ToolReport[] = [];

  try {
    // Connect with startup timeout
    const connectPromise = client.connect(transport as unknown as Transport);
    const startupDeadline = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("startup timeout")),
        startupTimeoutMs,
      ),
    );

    try {
      await Promise.race([connectPromise, startupDeadline]);
      connected = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      if (transport.sizeLimitExceeded) {
        findings.push(
          makeFinding(
            "STDIO_RESPONSE_SIZE_EXCEEDED",
            "FAIL",
            `Server stdout exceeded the ${maxResponseSizeBytes}-byte limit`,
          ),
        );
      } else if (msg === "startup timeout") {
        findings.push(
          makeFinding(
            "TIMEOUT",
            "FAIL",
            `Server did not complete MCP initialization within ${startupTimeoutMs}ms`,
          ),
        );
      } else if (transport.processExitCode !== null && transport.processExitCode !== 0) {
        findings.push(
          makeFinding(
            "STDIO_PROCESS_ERROR",
            "FAIL",
            `Server process exited with code ${transport.processExitCode} before initialization completed`,
          ),
        );
      } else {
        findings.push(
          makeFinding(
            "INIT_FAILURE",
            "FAIL",
            redactErrorMessage(err),
          ),
        );
      }

      // Clean up process (ignore errors — process may already be dead)
      await transport.close().catch(() => undefined);

      addTransportFindings(transport, findings);
      return buildReport(label, checkedAt, startMs, findings, [], null, null);
    }

    // Retrieve server version info
    const versionInfo = client.getServerVersion();
    if (versionInfo) {
      protocolVersion = versionInfo.version ?? null;
      const nameVal = (versionInfo as { name?: string }).name;
      serverInfo = {
        ...(nameVal !== undefined ? { name: nameVal } : {}),
        ...(versionInfo.version !== undefined ? { version: versionInfo.version } : {}),
      };
    }

    findings.push(
      makeFinding("INIT_OK", "PASS", "MCP initialization succeeded", {
        protocolVersion: protocolVersion ?? undefined,
      }),
    );

    // List tools
    try {
      const tools = await listTools(client);
      findings.push(
        makeFinding("TOOLS_LIST_OK", "PASS", `Found ${tools.length} tool(s)`),
      );
      const result = validateTools(tools);
      toolReports = result.toolReports;
      findings.push(...result.topLevelFindings);
    } catch (err) {
      findings.push(
        makeFinding(
          "TOOLS_LIST_FAILURE",
          "FAIL",
          `tools/list failed: ${redactErrorMessage(err)}`,
        ),
      );
    }

    // Close (calls transport.close() internally — handles the full shutdown)
    try {
      await client.close();
    } catch {
      // Ignore close errors; transport.close() is called below for cleanup
    }

  } catch (err) {
    findings.push(
      makeFinding(
        "STDIO_PROCESS_ERROR",
        "FAIL",
        `Unexpected error: ${redactErrorMessage(err)}`,
      ),
    );
    await transport.close().catch(() => undefined);
  }

  // Shutdown findings (only meaningful after a successful connection)
  if (connected) {
    if (transport.forcedKill) {
      findings.push(
        makeFinding(
          "STDIO_SHUTDOWN_TIMEOUT",
          "WARNING",
          `Server process did not exit within ${shutdownTimeoutMs}ms and required SIGKILL`,
        ),
      );
    }
  }

  // Transport-level findings (applicable regardless of whether init succeeded)
  addTransportFindings(transport, findings);

  return buildReport(
    label,
    checkedAt,
    startMs,
    findings,
    toolReports,
    protocolVersion,
    serverInfo,
  );
}

function addTransportFindings(
  transport: StdioValidatingTransport,
  findings: Finding[],
): void {
  if (transport.unexpectedLines.length > 0) {
    findings.push(
      makeFinding(
        "STDIO_UNEXPECTED_OUTPUT",
        "WARNING",
        `Server wrote ${transport.unexpectedLines.length} non-protocol line(s) to stdout. ` +
          "Logs must go to stderr.",
        {
          count: transport.unexpectedLines.length,
          preview: transport.unexpectedLines[0],
        },
      ),
    );
  }

  if (transport.framingErrors.length > 0) {
    findings.push(
      makeFinding(
        "STDIO_FRAMING_ERROR",
        "FAIL",
        `Server sent ${transport.framingErrors.length} malformed MCP protocol message(s) on stdout`,
        { count: transport.framingErrors.length },
      ),
    );
  }

  if (
    transport.sizeLimitExceeded &&
    !findings.some((f) => f.code === "STDIO_RESPONSE_SIZE_EXCEEDED")
  ) {
    findings.push(
      makeFinding(
        "STDIO_RESPONSE_SIZE_EXCEEDED",
        "FAIL",
        "Server stdout exceeded the configured response size limit",
      ),
    );
  }
}
