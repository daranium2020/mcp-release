import { type CheckReport, makeFinding, worstSeverity, type Finding } from "./report.js";
import { connectToMcpServer, listTools, TransportError, RateLimitTransportError, AuthChallengeTransportError, type ConnectOptions } from "./transport.js";
import { validateTools } from "./validator.js";
import { SsrfError } from "./ssrf.js";
import { redactUrl } from "./redact.js";
import { describeTransportError, type TransportDiagnostic } from "./diagnostics.js";
import { parseRetryAfterMs } from "./rate-limit.js";

/**
 * Extract a numeric HTTP status code from the cause of a TransportError.
 *
 * The MCP SDK throws StreamableHTTPError with a numeric .code equal to the
 * HTTP response status. Valid HTTP status codes are always in the range
 * 100–599. OS/network errors use string codes (e.g. "ECONNREFUSED").
 * JSON-RPC error codes (e.g. -32600) are negative and explicitly excluded
 * so they are not misclassified as HTTP responses.
 *
 * Returns null for any other error shape — never throws.
 */
function extractHttpStatus(err: TransportError): number | null {
  const cause = err.cause;
  if (cause == null || typeof cause !== "object") return null;
  const code = (cause as { code?: unknown }).code;
  if (typeof code !== "number" || !Number.isFinite(code)) return null;
  // Restrict to the valid HTTP status-code range. JSON-RPC error codes
  // (e.g. -32600, -32601) are negative and must not reach the HTTP branch.
  if (code < 100 || code > 599) return null;
  return code;
}

/**
 * Detect a JSON-RPC protocol error code in the cause of a TransportError.
 *
 * When the MCP SDK receives a JSON-RPC error response (e.g., to an
 * `initialize` request), it throws McpError with a numeric .code equal to
 * the JSON-RPC error code — always a negative integer per the JSON-RPC 2.0
 * specification (standard range: -32700 to -32600; implementation range:
 * -32099 to -32000).
 *
 * This helper is checked only after extractHttpStatus() returns null, so
 * there is no risk of an HTTP status code being misidentified as an RPC code.
 *
 * Returns null when the cause has no recognizable JSON-RPC error code.
 */
function extractRpcErrorCode(err: TransportError): number | null {
  const cause = err.cause;
  if (cause == null || typeof cause !== "object") return null;
  const code = (cause as { code?: unknown }).code;
  if (typeof code !== "number" || !Number.isFinite(code)) return null;
  // JSON-RPC error codes are always negative. HTTP status codes are always
  // ≥ 100, so a negative value here unambiguously identifies a protocol error.
  if (code >= 0) return null;
  return code;
}

/**
 * Parse only the standardized `error=` parameter from a WWW-Authenticate header.
 *
 * SECURITY: We read only the structured `error=` parameter (RFC 6750 §3.1).
 * We never read, log, or emit:
 *   - The response body (may contain server-controlled strings)
 *   - The `error_description=` parameter (server-controlled, may contain secrets)
 *   - The `error_uri=` parameter
 *
 * Returns the lowercased error code (e.g. "invalid_token"), or null if absent/unparseable.
 */
function parseWwwAuthError(header: string | null): string | null {
  if (!header) return null;
  const match = /\berror="([^"]+)"/i.exec(header);
  return match ? match[1]!.toLowerCase() : null;
}

/**
 * Whether the WWW-Authenticate error= code is an unambiguous expiry indicator.
 *
 * RFC 6750 §3.1 `invalid_token` covers expired, revoked, AND malformed tokens
 * and is therefore too broad to classify as AUTH_EXPIRED. Only non-standard
 * codes that unambiguously signal expiry are accepted here. Servers using the
 * standard `invalid_token` code will produce AUTH_INVALID; this is a
 * documented limitation.
 *
 * Accepted: "expired", "token_expired"
 * Rejected: "invalid_token" (RFC 6750, too broad)
 */
function isExpiredTokenIndicator(errorCode: string | null): boolean {
  return errorCode === "expired" || errorCode === "token_expired";
}

export type CheckOptions = {
  timeoutMs?: number;
  maxRedirects?: number;
  /** Allow HTTP (only valid in test/development environments) */
  allowHttp?: boolean;
  /**
   * Allow connections to private/loopback/link-local IP ranges.
   *
   * NEVER set by the web API. Only the CLI and GitHub Action set this,
   * because they run in the user's own environment where private-network
   * access is intentional. Web SSRF protections remain fully intact.
   */
  allowPrivateNetworks?: boolean;
  /**
   * Additional HTTP headers sent with every MCP request (e.g., Authorization).
   * Used by the CLI and GitHub Action for authenticated endpoints.
   * The web API never sets this — the web checker accepts no credentials.
   */
  requestHeaders?: Record<string, string>;
  /**
   * Optional callback invoked on transport failure with a sanitized diagnostic
   * record. Called server-side only; never forwarded to the client response.
   */
  onDiagnostic?: (d: TransportDiagnostic) => void;
  /**
   * Timeout for individual HTTP responses (separate from connect timeout).
   * Added in v0.3.0 for fine-grained timeout classification.
   */
  responseTimeoutMs?: number;
};

export async function runCheck(
  serverUrl: string,
  opts: CheckOptions = {},
): Promise<CheckReport> {
  const checkedAt = new Date().toISOString();
  const startMs = Date.now();
  const safeUrl = redactUrl(serverUrl);
  const findings: Finding[] = [];

  const ssrfOpts = {
    allowHttp: opts.allowHttp ?? false,
    allowPrivateNetworks: opts.allowPrivateNetworks ?? false,
  };

  let connectResult: Awaited<ReturnType<typeof connectToMcpServer>> | null = null;

  try {
    const connectOpts: ConnectOptions = { ssrf: ssrfOpts };
    if (opts.timeoutMs !== undefined) connectOpts.timeoutMs = opts.timeoutMs;
    if (opts.maxRedirects !== undefined) connectOpts.maxRedirects = opts.maxRedirects;
    if (opts.requestHeaders !== undefined) connectOpts.requestHeaders = opts.requestHeaders;
    if (opts.responseTimeoutMs !== undefined) connectOpts.responseTimeoutMs = opts.responseTimeoutMs;
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
    } else if (err instanceof AuthChallengeTransportError) {
      // 401 Unauthorized — carries WWW-Authenticate from the response header.
      // We inspect ONLY the structured `error=` parameter from the header.
      // The response body and error_description are never read or emitted.
      const wwwError = parseWwwAuthError(err.wwwAuthenticate);
      const hasCredentials =
        opts.requestHeaders !== undefined &&
        Object.keys(opts.requestHeaders).some((k) =>
          k.toLowerCase() === "authorization" || k.toLowerCase() === "x-api-key",
        );
      if (hasCredentials) {
        if (isExpiredTokenIndicator(wwwError)) {
          findings.push(
            makeFinding(
              "AUTH_EXPIRED",
              "FAIL",
              "The provided credentials have expired or been revoked. Obtain new credentials and retry.",
            ),
          );
        } else {
          findings.push(
            makeFinding(
              "AUTH_INVALID",
              "FAIL",
              "Server rejected the provided credentials (401 Unauthorized).",
            ),
          );
        }
      } else {
        findings.push(
          makeFinding(
            "AUTH_REQUIRED",
            "WARNING",
            "Server requires authorization. Authenticated checks were not performed.",
          ),
        );
      }
    } else if (err instanceof RateLimitTransportError) {
      // 429 Too Many Requests — carries Retry-After from the response header.
      const retryAfterMs = parseRetryAfterMs(err.retryAfter);
      const context: Record<string, unknown> = { attempts: 1 };
      if (err.retryAfter !== null) context["retryAfter"] = err.retryAfter;
      if (retryAfterMs === null && err.retryAfter !== null) {
        // Retry-After present but not parseable
        findings.push(
          makeFinding("RETRY_AFTER_INVALID", "WARNING",
            "Server returned a Retry-After header that could not be parsed.",
            { retryAfter: err.retryAfter }),
        );
      }
      findings.push(
        makeFinding("RATE_LIMITED", "FAIL",
          "Server returned 429 Too Many Requests. Retry when the rate limit resets.",
          context),
      );
    } else if (err instanceof TransportError) {
      // HTTP status is extracted FIRST. The MCP SDK embeds the raw server response
      // body in err.message for every HTTP-status error. Any error with a recognized
      // numeric status must be classified by status alone — err.message must never
      // be inspected or forwarded. Message-substring classification runs only when
      // both httpStatus and rpcCode are null (genuine transport failures).
      const httpStatus = extractHttpStatus(err);
      const rpcCode = extractRpcErrorCode(err);
      const hasCredentials =
        opts.requestHeaders !== undefined &&
        Object.keys(opts.requestHeaders).some((k) =>
          k.toLowerCase() === "authorization" || k.toLowerCase() === "x-api-key",
        );
      if (httpStatus === 401) {
        if (hasCredentials) {
          findings.push(
            makeFinding(
              "AUTH_INVALID",
              "FAIL",
              "Server rejected the provided credentials (401 Unauthorized).",
            ),
          );
        } else {
          findings.push(
            makeFinding(
              "AUTH_REQUIRED",
              "WARNING",
              "Server requires authorization. Authenticated checks were not performed.",
            ),
          );
        }
      } else if (httpStatus === 403) {
        findings.push(
          makeFinding("AUTH_FORBIDDEN", "FAIL",
            "Server denied access (403 Forbidden). The credentials may lack required permissions."),
        );
      } else if (httpStatus !== null) {
        // Any other recognized HTTP status (400, 404, 500, 502, …):
        // fixed message only — no err.message, no response body.
        findings.push(
          makeFinding(
            "REMOTE_HTTP_ERROR",
            "FAIL",
            "Remote MCP server returned an unexpected HTTP response.",
          ),
        );
      } else if (rpcCode !== null) {
        // JSON-RPC protocol error during initialize (e.g., McpError{code: -32600}).
        findings.push(
          makeFinding(
            "INIT_FAILURE",
            "FAIL",
            "MCP initialization failed: the server returned a protocol error.",
            { rpcCode },
          ),
        );
      } else if (err.message === "Response timeout") {
        findings.push(
          makeFinding("RESPONSE_TIMEOUT", "FAIL",
            "The server connected but did not return a response within the timeout."),
        );
      } else if (err.message === "Connection timeout" || err.message.includes("timeout")) {
        findings.push(
          makeFinding("CONNECT_TIMEOUT", "FAIL",
            "Could not establish a connection to the server within the timeout."),
        );
      } else if (err.message.includes("Redirect limit")) {
        findings.push(
          makeFinding("REDIRECT_LIMIT_EXCEEDED", "FAIL", err.message),
        );
      } else if (err.message.includes("Redirect loop")) {
        findings.push(
          makeFinding("REDIRECT_LOOP", "FAIL", err.message),
        );
      } else if (err.message.includes("Protocol downgrade")) {
        findings.push(
          makeFinding("PROTOCOL_DOWNGRADE", "FAIL", err.message),
        );
      } else {
        // Genuine network failure (ECONNREFUSED, TLS error, ERR_SOCKET_BAD_PORT, …).
        opts.onDiagnostic?.(describeTransportError(err, "transport_connect"));
        findings.push(makeFinding("TRANSPORT_ERROR", "FAIL", err.message));
      }
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
      overallStatus: worstSeverity(findings),
      transport: {
        httpStatus: null,
        httpStatusText: null,
        durationMs,
        redirectCount: 0,
        headersAvailable: false,
      },
      transportType: "http" as const,
      startedAt: checkedAt,
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
    transportType: "http" as const,
    startedAt: checkedAt,
    protocolVersion: connectResult.protocolVersion,
    serverInfo: connectResult.serverInfo,
    findings,
    tools: toolReports,
  };
}
