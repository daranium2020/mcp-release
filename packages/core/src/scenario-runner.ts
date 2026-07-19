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

  let finalReport: CheckResult | null = null;
  let attempts = 0;
  let usedRetryCategory: RetryCategory | null = null;

  for (let attempt = 1; attempt <= retry.maxAttempts; attempt++) {
    attempts = attempt;

    if (Date.now() >= deadline) {
      const now = new Date().toISOString();
      finalReport = {
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
            `Scenario "${scenario.name}" exceeded its ${scenarioTimeoutMs}ms budget before attempt ${attempt}.`,
            { scenarioTimeoutMs, attempt },
          ),
        ],
        tools: [],
        scenarioName: scenario.name,
        attempts,
      };
      break;
    }

    const report = await runCheck(serverUrl, checkOptions);

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
        await sleep(clampRetryAfterMs(rawMs));
        continue;
      }

      // 5xx: retry if server-error category enabled
      if (hasCode(report, SERVER_ERROR_CODES) && retry.retryOn.has("server-error")) {
        usedRetryCategory = "server-error";
        await sleep(retry.backoffMs);
        continue;
      }

      // Connection failure: retry if connection-failure category enabled
      if (hasCode(report, CONNECTION_FAILURE_CODES) && retry.retryOn.has("connection-failure")) {
        usedRetryCategory = "connection-failure";
        await sleep(retry.backoffMs);
        continue;
      }

      // Response timeout: retry if response-timeout category enabled
      if (hasCode(report, RESPONSE_TIMEOUT_CODES) && retry.retryOn.has("response-timeout")) {
        usedRetryCategory = "response-timeout";
        await sleep(retry.backoffMs);
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
    finalReport = await runCheck(serverUrl, checkOptions);
    attempts = 1;
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
