import { type CheckReport, makeFinding, worstSeverity, type Finding } from "./report.js";
import { connectToMcpServer, listTools, TransportError, type ConnectOptions } from "./transport.js";
import { validateTools } from "./validator.js";
import { SsrfError } from "./ssrf.js";
import { redactUrl } from "./redact.js";
import { describeTransportError, type TransportDiagnostic } from "./diagnostics.js";

export type CheckOptions = {
  timeoutMs?: number;
  maxRedirects?: number;
  /** Allow HTTP (only valid in test/development environments) */
  allowHttp?: boolean;
  /**
   * Optional callback invoked on transport failure with a sanitized diagnostic
   * record. Called server-side only; never forwarded to the client response.
   */
  onDiagnostic?: (d: TransportDiagnostic) => void;
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
        makeFinding("SSRF_BLOCKED", "FAIL", err.message, { reason: err.reason }),
      );
    } else if (err instanceof TransportError && err.cause instanceof SsrfError) {
      const cause = err.cause;
      if (cause.reason === "HTTPS_REQUIRED") {
        findings.push(
          makeFinding("HTTPS_REQUIRED", "FAIL", "HTTPS is required in production mode"),
        );
      } else if (cause.reason === "EMBEDDED_CREDENTIALS") {
        findings.push(
          makeFinding("EMBEDDED_CREDENTIALS", "FAIL", cause.message),
        );
      } else if (cause.reason === "PROTOCOL_DOWNGRADE") {
        findings.push(
          makeFinding("PROTOCOL_DOWNGRADE", "FAIL", "Protocol downgrade (HTTPS → HTTP) blocked"),
        );
      } else {
        findings.push(makeFinding("SSRF_BLOCKED", "FAIL", cause.message, { reason: cause.reason }));
      }
    } else if (err instanceof TransportError && err.message.includes("timeout")) {
      findings.push(
        makeFinding("TIMEOUT", "FAIL", `Connection timed out: ${err.message}`),
      );
    } else if (err instanceof TransportError && err.message.includes("Redirect limit")) {
      findings.push(
        makeFinding("REDIRECT_LIMIT_EXCEEDED", "FAIL", err.message),
      );
    } else if (err instanceof TransportError && err.message.includes("Redirect loop")) {
      findings.push(
        makeFinding("REDIRECT_LOOP", "FAIL", err.message),
      );
    } else if (err instanceof TransportError && err.message.includes("Protocol downgrade")) {
      findings.push(
        makeFinding("PROTOCOL_DOWNGRADE", "FAIL", err.message),
      );
    } else if (err instanceof TransportError) {
      opts.onDiagnostic?.(describeTransportError(err, "transport_connect"));
      findings.push(makeFinding("TRANSPORT_ERROR", "FAIL", err.message));
    } else {
      findings.push(
        makeFinding("TRANSPORT_ERROR", "FAIL", `Unexpected error: ${String(err)}`),
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

  let tools: Awaited<ReturnType<typeof listTools>> = [];
  try {
    tools = await listTools(connectResult.client);
    findings.push(
      makeFinding("TOOLS_LIST_OK", "PASS", `Found ${tools.length} tool(s)`),
    );
  } catch (err) {
    findings.push(
      makeFinding("TOOLS_LIST_FAILURE", "FAIL", `tools/list failed: ${String(err)}`),
    );
  }

  const { toolReports, topLevelFindings } = validateTools(tools);
  findings.push(...topLevelFindings);

  try {
    await connectResult.client.close();
  } finally {
    await connectResult.disposeConnection();
  }

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
