import { runCheck, redactErrorMessage, type CheckOptions, type CheckReport, type TransportDiagnostic } from "@mcp-release/core";
import {
  defaultRateLimiter,
  type RateLimiter,
} from "../../../lib/rate-limit";
import {
  defaultConcurrencyGuard,
  type ConcurrencyGuard,
} from "../../../lib/concurrency";
import {
  DEFAULT_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  PRODUCT_VERSION,
} from "../../../lib/constants";
import { logCheckStart, logCheckComplete, type Outcome } from "../../../lib/usage-log";

// Hard cap above the user-configurable max to catch runaway validators.
const MAX_EXECUTION_MS = MAX_TIMEOUT_MS + 5_000;
const MAX_BODY_BYTES = 4_096;

export type ValidatorFn = (
  url: string,
  opts: CheckOptions,
) => Promise<CheckReport>;

export type HandlerDeps = {
  validator?: ValidatorFn;
  rateLimiter?: RateLimiter;
  concurrencyGuard?: ConcurrencyGuard;
};

function securityHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Cache-Control": "no-store",
    // No CORS headers — this endpoint is same-origin only.
  };
}

function errorJson(
  status: number,
  error: string,
  message: string,
): Response {
  return new Response(JSON.stringify({ error, message }), {
    status,
    headers: securityHeaders(),
  });
}

// x-forwarded-for is used as a best-effort rate-limit key. It is not verified
// against a trusted proxy and may be spoofable without one in front.
function extractIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "direct"
  );
}

export async function handleCheckRequest(
  req: Request,
  deps: HandlerDeps = {},
): Promise<Response> {
  const rateLimiter = deps.rateLimiter ?? defaultRateLimiter;
  const concurrencyGuard = deps.concurrencyGuard ?? defaultConcurrencyGuard;
  const validator = deps.validator ?? runCheck;

  // 1. Method guard (belt-and-suspenders; Next.js route config handles this)
  if (req.method !== "POST") {
    return errorJson(405, "METHOD_NOT_ALLOWED", "Only POST is accepted");
  }

  // 2. Content-Type must be application/json
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    return errorJson(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Content-Type must be application/json",
    );
  }

  // 3. Body size limit (read as text first to measure)
  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return errorJson(
      413,
      "BODY_TOO_LARGE",
      `Request body must not exceed ${MAX_BODY_BYTES} bytes`,
    );
  }

  // 4. Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return errorJson(400, "INVALID_JSON", "Request body must be valid JSON");
  }

  // 5. Structural validation
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    return errorJson(400, "INVALID_BODY", "Request body must be a JSON object");
  }

  const body = parsed as Record<string, unknown>;

  // Reject unexpected fields — prevents parameter injection / confusion
  const ALLOWED = new Set(["endpoint", "timeoutMs"]);
  for (const key of Object.keys(body)) {
    if (!ALLOWED.has(key)) {
      return errorJson(400, "UNEXPECTED_FIELD", `Unexpected field: "${key}"`);
    }
  }

  // 6. endpoint validation
  const rawEndpoint = body["endpoint"];
  if (typeof rawEndpoint !== "string" || rawEndpoint.trim().length === 0) {
    return errorJson(400, "MISSING_ENDPOINT", "endpoint is required");
  }

  let endpointUrl: URL;
  try {
    endpointUrl = new URL(rawEndpoint);
  } catch {
    return errorJson(400, "INVALID_URL", "endpoint must be a valid URL");
  }

  if (endpointUrl.username || endpointUrl.password) {
    return errorJson(
      400,
      "EMBEDDED_CREDENTIALS",
      "endpoint must not contain embedded credentials",
    );
  }

  if (endpointUrl.protocol !== "https:") {
    return errorJson(
      400,
      "HTTPS_REQUIRED",
      "endpoint must use HTTPS in production",
    );
  }

  // 7. timeoutMs validation
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (body["timeoutMs"] !== undefined) {
    const t = body["timeoutMs"];
    if (
      typeof t !== "number" ||
      !Number.isFinite(t) ||
      t < MIN_TIMEOUT_MS ||
      t > MAX_TIMEOUT_MS
    ) {
      return errorJson(
        400,
        "INVALID_TIMEOUT",
        `timeoutMs must be a number between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}`,
      );
    }
    timeoutMs = Math.floor(t);
  }

  // 8. Rate limiting — checked after input validation to avoid leaking info
  const ip = extractIp(req);
  if (!rateLimiter.tryConsume(ip)) {
    return errorJson(
      429,
      "RATE_LIMIT_EXCEEDED",
      "Too many requests. Please try again later.",
    );
  }

  // 9. Concurrency limiting
  if (!concurrencyGuard.tryAcquire()) {
    return errorJson(
      429,
      "CONCURRENCY_LIMIT_EXCEEDED",
      "Server is busy. Please try again shortly.",
    );
  }

  const hostname = endpointUrl.hostname;
  const startMs = Date.now();
  logCheckStart(hostname);

  try {
    // 10. Run validation with hard execution time cap.
    // The validator has its own timeout (timeoutMs) but we add an outer
    // deadline as a safety net for unexpected hangs.
    const execDeadline = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Execution time limit exceeded")),
        MAX_EXECUTION_MS,
      ),
    );

    const rawReport = await Promise.race([
      validator(rawEndpoint.trim(), {
        timeoutMs,
        allowHttp: false,
        onDiagnostic: (d: TransportDiagnostic) => {
          // Emit a fixed-schema structured record to server-side logs only.
          // Never forwarded to the client response.
          console.error(
            JSON.stringify({ level: "error", event: "transport_diagnostic", ...d }),
          );
        },
      }),
      execDeadline,
    ]);

    // Enrich with browser-context metadata before returning to the client.
    const report: CheckReport = {
      ...rawReport,
      startedAt: rawReport.checkedAt,
      mcpReleaseVersion: PRODUCT_VERSION,
      executionEnvironment: "browser",
    };

    const outcome: Outcome =
      report.overallStatus === "PASS" ? "pass" :
      report.overallStatus === "WARNING" ? "warn" : "fail";
    logCheckComplete(hostname, outcome, Date.now() - startMs, report.tools.length);

    return new Response(JSON.stringify({ report }), {
      status: 200,
      headers: securityHeaders(),
    });
  } catch (err) {
    const errorCategory =
      err instanceof Error && err.message === "Execution time limit exceeded"
        ? "timeout"
        : "validator_error";
    logCheckComplete(hostname, "error", Date.now() - startMs, undefined, errorCategory);

    // Redact sensitive patterns (token=...) and URL credentials (user:pass@)
    // from error messages before returning. redactErrorMessage handles token
    // patterns; the second pass strips embedded URL credentials not caught by
    // the token pattern (e.g., https://user:secret@host).
    const base = redactErrorMessage(err);
    const safe = base.replace(/https?:\/\/[^@\s"']+@/gi, "https://[REDACTED]@");
    return errorJson(500, "VALIDATOR_ERROR", safe);
  } finally {
    concurrencyGuard.release();
  }
}
