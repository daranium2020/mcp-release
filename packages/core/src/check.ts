import { type CheckReport, makeFinding, worstSeverity, type Finding } from "./report.js";
import { connectToMcpServer, listTools, TransportError, type ConnectOptions } from "./transport.js";
import { validateTools } from "./validator.js";
import { SsrfError } from "./ssrf.js";
import { redactUrl } from "./redact.js";

export type CheckOptions = {
  timeoutMs?: number;
  maxRedirects?: number;
  /** Allow HTTP (only valid in test/development environments) */
  allowHttp?: boolean;
};

export async function runCheck(
  serverUrl: string,
  opts: CheckOptions = {},
): Promise<CheckReport> {
  const checkedAt = new Date().toISOString();
  const startMs = Date.now();
  const safeUrl = redactUrl(serverUrl);
  const findings: Finding[] = [];

  const ssrfOpts = { allowHttp: opts.allowHttp ?? false };

  let connectResult: Awaited<ReturnType<typeof connectToMcpServer>> | null = null;

  try {
    const connectOpts: ConnectOptions = { ssrf: ssrfOpts };
    if (opts.timeoutMs !== undefined) connectOpts.timeoutMs = opts.timeoutMs;
    if (opts.maxRedirects !== undefined) connectOpts.maxRedirects = opts.maxRedirects;
    connectResult = await connectToMcpServer(serverUrl, connectOpts);
  } catch (err) {
    const durationMs = Date.now() - startMs;

    if (err instanceof SsrfError) {
      findings.push(
        makeFinding("SSRF_BLOCKED", "FAIL", err.message, {
          reason: err.reason,
        }),
      );
    } else if (
      err instanceof TransportError &&
      err.message.includes("timeout")
    ) {
      findings.push(
        makeFinding("TIMEOUT", "FAIL", `Connection timed out: ${err.message}`),
      );
    } else if (
      err instanceof TransportError &&
      err.message.includes("Redirect limit")
    ) {
      findings.push(
        makeFinding(
          "REDIRECT_LIMIT_EXCEEDED",
          "FAIL",
          err.message,
        ),
      );
    } else if (err instanceof TransportError) {
      const cause = err.cause;
      if (cause instanceof SsrfError && cause.reason === "HTTPS_REQUIRED") {
        findings.push(
          makeFinding(
            "HTTPS_REQUIRED",
            "FAIL",
            "HTTPS is required in production mode",
          ),
        );
      } else {
        findings.push(
          makeFinding("TRANSPORT_ERROR", "FAIL", err.message),
        );
      }
    } else {
      findings.push(
        makeFinding(
          "TRANSPORT_ERROR",
          "FAIL",
          `Unexpected error: ${String(err)}`,
        ),
      );
    }

    return {
      schemaVersion: "1",
      serverUrl: safeUrl,
      checkedAt,
      durationMs,
      overallStatus: "FAIL",
      transport: {
        httpStatus: null,
        httpStatusText: null,
        durationMs,
        redirectCount: 0,
        headersAvailable: false,
      },
      protocolVersion: null,
      serverInfo: null,
      findings,
      tools: [],
    };
  }

  findings.push(
    makeFinding("INIT_OK", "PASS", "MCP initialization succeeded", {
      protocolVersion: connectResult.protocolVersion,
    }),
  );

  // Fetch tools list
  let tools: Awaited<ReturnType<typeof listTools>> = [];
  try {
    tools = await listTools(connectResult.client);
    findings.push(
      makeFinding("TOOLS_LIST_OK", "PASS", `Found ${tools.length} tool(s)`),
    );
  } catch (err) {
    findings.push(
      makeFinding(
        "TOOLS_LIST_FAILURE",
        "FAIL",
        `tools/list failed: ${String(err)}`,
      ),
    );
  }

  // Validate tools
  const { toolReports, topLevelFindings } = validateTools(tools);
  findings.push(...topLevelFindings);

  await connectResult.client.close();

  const durationMs = Date.now() - startMs;
  const allFindings = [...findings, ...toolReports.flatMap((t) => t.findings)];

  return {
    schemaVersion: "1",
    serverUrl: safeUrl,
    checkedAt,
    durationMs,
    overallStatus: worstSeverity(allFindings),
    transport: {
      httpStatus: connectResult.httpStatus,
      httpStatusText: null,
      durationMs: connectResult.durationMs,
      redirectCount: connectResult.redirectCount,
      headersAvailable: false,
    },
    protocolVersion: connectResult.protocolVersion,
    serverInfo: connectResult.serverInfo,
    findings,
    tools: toolReports,
  };
}
