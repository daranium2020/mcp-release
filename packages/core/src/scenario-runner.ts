/**
 * Scenario runner for config-file based checks (v0.3.0).
 *
 * Retry rules — retries are OFF by default. Each failure category must be
 * explicitly opted in via retryOn:
 *
 *   "rate-limit"         HTTP 429 (RATE_LIMITED)
 *   "server-error"       5xx responses (REMOTE_HTTP_ERROR)
 *   "connection-failure" Connection-level errors (CONNECT_TIMEOUT, TRANSPORT_ERROR)
 *   "response-timeout"   Response timeout (RESPONSE_TIMEOUT)
 *
 * Never retried regardless of configuration:
 *   400, 401, 403, schema validation errors, malformed MCP responses, SCENARIO_TIMEOUT
 *
 * SCENARIO_TIMEOUT is a hard wall-clock deadline:
 *   - One AbortController is created per scenario when scenarioTimeoutMs > 0.
 *   - Its signal is passed to every runCheck() call and into connectToMcpServer
 *     so it can abort any in-flight TCP connection, HTTP response, or request.
 *   - Backoff sleeps between retries are also abortable via the same signal.
 *   - When the deadline fires mid-request, check.ts emits SCENARIO_TIMEOUT
 *     (not CONNECT_TIMEOUT or RESPONSE_TIMEOUT).
 *   - When it fires during backoff, the sleep is interrupted immediately.
 *   - The scenario timer is always cleared in a finally block to prevent leaks.
 */

import { runCheck, type CheckOptions } from "./check.js";
import { makeFinding, worstSeverity, type FindingSeverity } from "./report.js";
import type { ScenarioExpectation, ScenarioResult, ConfigReport } from "./config-report.js";
import { sleep, parseRetryAfterMs, clampRetryAfterMs, MAX_RETRY_AFTER_MS } from "./rate-limit.js";

export type RetryCategory =
  | "rate-limit"
  | "server-error"
  | "connection-failure"
  | "response-timeout";

export type RetryOptions = {
  /** Total attempt limit. 1 means no retries. */
  maxAttempts: number;
  /** Fixed backoff in ms between non-rate-limit retries. */
  backoffMs: number;
  /** Which failure categories are eligible for retry. Empty = no retries. */
  retryOn: Set<RetryCategory>;
};

export type ScenarioInput = {
  name: string;
  extraHeaders: Record<string, string>;
  removeHeaders: string[];
  expected: ScenarioExpectation;
};

const RATE_LIMIT_CODES = new Set(["RATE_LIMITED"]);
const SERVER_ERROR_CODES = new Set(["REMOTE_HTTP_ERROR"]);
const CONNECTION_FAILURE_CODES = new Set(["TRANSPORT_ERROR", "CONNECT_TIMEOUT"]);
const RESPONSE_TIMEOUT_CODES = new Set(["RESPONSE_TIMEOUT"]);
const SCENARIO_TIMEOUT_CODES = new Set(["SCENARIO_TIMEOUT"]);

type CheckResult = Awaited<ReturnType<typeof runCheck>>;

function buildScenarioHeaders(
  base: Record<string, string>,
  extra: Record<string, string>,
  remove: string[],
): Record<string, string> {
  const removeLower = new Set(remove.map((h) => h.toLowerCase()));
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (!removeLower.has(k.toLowerCase())) merged[k] = v;
  }
  for (const [k, v] of Object.entries(extra)) merged[k] = v;
  return merged;
}

function getRateLimitRetryAfter(report: CheckResult): string | null {
  const f = report.findings.find((f) => f.code === "RATE_LIMITED");
  return f ? ((f.context?.["retryAfter"] as string | undefined) ?? null) : null;
}

function hasCode(report: CheckResult, codes: Set<string>): boolean {
  return report.findings.some((f) => codes.has(f.code));
}

function inferHttpStatusFromFindings(report: CheckResult): number | null {
  for (const f of report.findings) {
    if (f.code === "AUTH_REQUIRED" || f.code === "AUTH_INVALID" || f.code === "AUTH_EXPIRED") return 401;
    if (f.code === "AUTH_FORBIDDEN") return 403;
    if (f.code === "RATE_LIMITED") return 429;
  }
  return null;
}

function getActualHttpStatus(report: CheckResult): number | null {
  return report.transport?.httpStatus ?? inferHttpStatusFromFindings(report);
}

function scenarioMatches(
  expected: ScenarioExpectation,
  actualResult: FindingSeverity,
  actualHttpStatus: number | null,
): boolean {
  if (expected.result !== undefined) {
    if (actualResult !== expected.result.toUpperCase()) return false;
  }
  if (expected.httpStatus !== undefined) {
    if (actualHttpStatus !== expected.httpStatus) return false;
  }
  return true;
}

/** Sleep for ms, aborting immediately if signal fires before the timer ends. */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("Scenario aborted")); return; }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("Scenario aborted"));
    }, { once: true });
  });
}

/**
 * Await a backoff sleep bounded by the scenario signal.
 * Returns true when the sleep completed normally, false when the scenario
 * deadline fired during the wait (caller must emit SCENARIO_TIMEOUT and stop).
 */
async function backoffAndCheck(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (!signal) { await sleep(ms); return true; }
  try {
    await abortableSleep(ms, signal);
    return true;
  } catch {
    return false;
  }
}

/** Build a SCENARIO_TIMEOUT CheckResult for use when the deadline fires. */
function makeScenarioTimeoutReport(
  serverUrl: string,
  scenarioName: string,
  scenarioTimeoutMs: number,
  attempts: number,
  startMs: number,
): CheckResult {
  const now = new Date().toISOString();
  return {
    schemaVersion: "1",
    serverUrl,
    checkedAt: now,
    startedAt: now,
    durationMs: Date.now() - startMs,
    overallStatus: "FAIL",
    transport: null,
    transportType: "http" as const,
    protocolVersion: null,
    serverInfo: null,
    findings: [
      makeFinding(
        "SCENARIO_TIMEOUT",
        "FAIL",
        `Scenario "${scenarioName}" exceeded its ${scenarioTimeoutMs}ms budget.`,
        { scenarioTimeoutMs },
      ),
    ],
    tools: [],
    scenarioName,
    attempts,
  };
}

async function runSingleScenario(
  serverUrl: string,
  scenario: ScenarioInput,
  baseCheckOptions: CheckOptions,
  retry: RetryOptions,
  scenarioTimeoutMs: number,
): Promise<ScenarioResult> {
  const startMs = Date.now();
  const deadline = scenarioTimeoutMs > 0 ? startMs + scenarioTimeoutMs : Infinity;

  const headers = buildScenarioHeaders(
    baseCheckOptions.requestHeaders ?? {},
    scenario.extraHeaders,
    scenario.removeHeaders,
  );
  const checkOptions: CheckOptions = {
    ...baseCheckOptions,
    ...(Object.keys(headers).length > 0 ? { requestHeaders: headers } : {}),
  };

  // Hard deadline: an AbortController fires at the scenario budget boundary.
  // Its signal is threaded into every runCheck() call so that in-flight TCP
  // connections, HTTP responses, and backoff sleeps are all interrupted when
  // the deadline expires — not just the inter-retry gap.
  const scenarioController = scenarioTimeoutMs > 0 ? new AbortController() : null;
  const scenarioSignal = scenarioController?.signal;
  let scenarioTimer: ReturnType<typeof setTimeout> | null = null;

  const checkOptionsWithSignal: CheckOptions = {
    ...checkOptions,
    ...(scenarioSignal !== undefined ? { scenarioSignal } : {}),
  };

  let finalReport: CheckResult | null = null;
  let attempts = 0;
  let usedRetryCategory: RetryCategory | null = null;

  try {
    if (scenarioController !== null) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        scenarioController.abort();
      } else {
        scenarioTimer = setTimeout(() => scenarioController.abort(), remaining);
      }
    }

    for (let attempt = 1; attempt <= retry.maxAttempts; attempt++) {
      // Fast path: abort already signalled (e.g. by a previous backoff expiry
      // or a very short remaining budget) — no new request should start.
      if (scenarioSignal?.aborted || Date.now() >= deadline) {
        usedRetryCategory = null;
        finalReport = makeScenarioTimeoutReport(
          serverUrl, scenario.name, scenarioTimeoutMs, attempts, startMs,
        );
        break;
      }

      const report = await runCheck(serverUrl, checkOptionsWithSignal);
      // Increment only after runCheck returns — a request that was aborted
      // mid-flight by the scenario signal still counts as started.
      attempts = attempt;

      // SCENARIO_TIMEOUT from an in-flight request — never retry.
      if (hasCode(report, SCENARIO_TIMEOUT_CODES)) {
        usedRetryCategory = null;
        finalReport = { ...report, durationMs: Date.now() - startMs, attempts };
        break;
      }

      if (attempt < retry.maxAttempts) {
        // 429: retry if rate-limit category enabled
        if (hasCode(report, RATE_LIMIT_CODES) && retry.retryOn.has("rate-limit")) {
          const retryAfter = getRateLimitRetryAfter(report);
          const rawMs = parseRetryAfterMs(retryAfter) ?? retry.backoffMs;
          if (rawMs > MAX_RETRY_AFTER_MS) {
            finalReport = {
              ...report,
              findings: [
                ...report.findings,
                makeFinding(
                  "RETRY_EXHAUSTED",
                  "FAIL",
                  `Retry-After (${retryAfter ?? "unknown"}) exceeds the ${MAX_RETRY_AFTER_MS / 1000}s cap. Stopped after attempt ${attempt}.`,
                  { attempt, retryAfter },
                ),
              ],
              overallStatus: "FAIL",
              durationMs: Date.now() - startMs,
              attempts,
            };
            break;
          }
          usedRetryCategory = "rate-limit";
          if (!await backoffAndCheck(clampRetryAfterMs(rawMs), scenarioSignal)) {
            usedRetryCategory = null;
            finalReport = makeScenarioTimeoutReport(
              serverUrl, scenario.name, scenarioTimeoutMs, attempts, startMs,
            );
            break;
          }
          continue;
        }

        // 5xx: retry if server-error category enabled
        if (hasCode(report, SERVER_ERROR_CODES) && retry.retryOn.has("server-error")) {
          usedRetryCategory = "server-error";
          if (!await backoffAndCheck(retry.backoffMs, scenarioSignal)) {
            usedRetryCategory = null;
            finalReport = makeScenarioTimeoutReport(
              serverUrl, scenario.name, scenarioTimeoutMs, attempts, startMs,
            );
            break;
          }
          continue;
        }

        // Connection failure: retry if connection-failure category enabled
        if (hasCode(report, CONNECTION_FAILURE_CODES) && retry.retryOn.has("connection-failure")) {
          usedRetryCategory = "connection-failure";
          if (!await backoffAndCheck(retry.backoffMs, scenarioSignal)) {
            usedRetryCategory = null;
            finalReport = makeScenarioTimeoutReport(
              serverUrl, scenario.name, scenarioTimeoutMs, attempts, startMs,
            );
            break;
          }
          continue;
        }

        // Response timeout: retry if response-timeout category enabled
        if (hasCode(report, RESPONSE_TIMEOUT_CODES) && retry.retryOn.has("response-timeout")) {
          usedRetryCategory = "response-timeout";
          if (!await backoffAndCheck(retry.backoffMs, scenarioSignal)) {
            usedRetryCategory = null;
            finalReport = makeScenarioTimeoutReport(
              serverUrl, scenario.name, scenarioTimeoutMs, attempts, startMs,
            );
            break;
          }
          continue;
        }
      }

      // Last attempt and still failing after multiple attempts — add RETRY_EXHAUSTED
      if (attempt === retry.maxAttempts && attempt > 1 && report.overallStatus === "FAIL") {
        finalReport = {
          ...report,
          findings: [
            ...report.findings,
            makeFinding(
              "RETRY_EXHAUSTED",
              "FAIL",
              `All ${retry.maxAttempts} attempts failed.`,
              { attempts: retry.maxAttempts, retryCategory: usedRetryCategory },
            ),
          ],
          overallStatus: "FAIL",
          durationMs: Date.now() - startMs,
          attempts,
        };
        break;
      }

      finalReport = { ...report, durationMs: Date.now() - startMs, attempts };
      break;
    }

    if (finalReport === null) {
      finalReport = await runCheck(serverUrl, checkOptionsWithSignal);
      attempts = 1;
    }
  } finally {
    // Always clear the scenario timer to prevent it from firing after the
    // scenario has already resolved (would call abort() on a settled signal).
    if (scenarioTimer !== null) clearTimeout(scenarioTimer);
  }

  const actualResult = finalReport.overallStatus;
  const actualHttpStatus = getActualHttpStatus(finalReport);
  const matched = scenarioMatches(scenario.expected, actualResult, actualHttpStatus);

  let scenarioReport = { ...finalReport, scenarioName: scenario.name, attempts };

  if (!matched) {
    const expectedDesc = [
      scenario.expected.result ? `result=${scenario.expected.result}` : null,
      scenario.expected.httpStatus !== undefined ? `httpStatus=${scenario.expected.httpStatus}` : null,
    ].filter(Boolean).join(", ");
    const actualDesc = [
      `result=${actualResult}`,
      actualHttpStatus !== null ? `httpStatus=${actualHttpStatus}` : null,
    ].filter(Boolean).join(", ");

    const mismatchFindings = [
      ...finalReport.findings,
      makeFinding(
        "AUTH_SCENARIO_MISMATCH",
        "FAIL",
        `Scenario "${scenario.name}" expected [${expectedDesc}] but got [${actualDesc}].`,
        { scenario: scenario.name, expected: scenario.expected, actual: { result: actualResult, httpStatus: actualHttpStatus } },
      ),
    ];
    scenarioReport = {
      ...scenarioReport,
      findings: mismatchFindings,
      overallStatus: worstSeverity([...mismatchFindings, ...finalReport.tools.flatMap((t) => t.findings)]),
    };
  }

  return {
    name: scenario.name,
    expected: scenario.expected,
    actual: { result: actualResult, httpStatus: actualHttpStatus },
    matched,
    attempts,
    maxAttempts: retry.maxAttempts,
    ...(usedRetryCategory !== null ? { retryCategory: usedRetryCategory } : {}),
    durationMs: Date.now() - startMs,
    report: scenarioReport,
  };
}

export type RetryInput = {
  maxAttempts?: number;
  backoffMs?: number;
  /** Categories to enable. Empty array or absent = no retries. */
  retryOn?: string[] | ReadonlyArray<string>;
};

export async function runScenarios(
  serverUrl: string,
  scenarios: ScenarioInput[],
  baseCheckOptions: CheckOptions,
  retryOptions?: RetryInput,
  scenarioTimeoutMs = 0,
): Promise<ScenarioResult[]> {
  const retryOn = new Set(
    (retryOptions?.retryOn ?? []) as RetryCategory[],
  );
  const retry: RetryOptions = {
    maxAttempts: retryOptions?.maxAttempts ?? 1,
    backoffMs: retryOptions?.backoffMs ?? 1000,
    retryOn,
  };

  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    results.push(
      await runSingleScenario(serverUrl, scenario, baseCheckOptions, retry, scenarioTimeoutMs),
    );
  }
  return results;
}

export function buildConfigReport(
  serverUrl: string,
  configFile: string,
  scenarioResults: ScenarioResult[],
  startedAt: string,
  startMs: number,
): Omit<ConfigReport, "mcpReleaseVersion" | "executionEnvironment"> {
  const severityOrder: Record<FindingSeverity, number> = { PASS: 0, WARNING: 1, FAIL: 2 };
  const overallStatus = scenarioResults.reduce<FindingSeverity>((worst, s) => {
    const effective: FindingSeverity = s.matched ? "PASS" : "FAIL";
    return severityOrder[effective] > severityOrder[worst] ? effective : worst;
  }, "PASS");

  return {
    schemaVersion: "1",
    configFile,
    serverUrl,
    startedAt,
    durationMs: Date.now() - startMs,
    overallStatus,
    scenarios: scenarioResults,
  };
}

export type { ConfigReport, ScenarioResult, ScenarioExpectation } from "./config-report.js";
