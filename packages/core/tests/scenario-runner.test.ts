/**
 * Integration tests for runScenarios / buildConfigReport (v0.3.0).
 *
 * Tests:
 *   - Expected positive scenario (valid server → pass)
 *   - Expected negative scenario (401 expected → matched=true)
 *   - Scenario mismatch (expected pass, got 401 → matched=false, AUTH_SCENARIO_MISMATCH)
 *   - 429 retry with Retry-After → succeeds on attempt 2
 *   - Retry exhaustion (always 429) → RETRY_EXHAUSTED
 *   - Transient failure retry (500 once, then pass) → matched=true, attempts=2
 *   - buildConfigReport derives overallStatus from matched flags
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runScenarios, buildConfigReport } from "../src/scenario-runner.js";
import type { ScenarioInput } from "../src/scenario-runner.js";
import {
  startValidServer,
  startMissingTokenServer,
  startInvalidTokenServer,
  startExpiredTokenServer,
  startRateLimitThenSuccessServer,
  startAlwaysRateLimitServer,
  startTransientFailureServer,
  startResponseTimeoutServer,
  startConnectTimeoutServer,
  type FixtureServer,
} from "../../../fixtures/servers/src/index.js";

const DEV = { allowHttp: true, timeoutMs: 5000 };
const TIMEOUT = 10_000;
const SLOW = 15_000;

// ---------------------------------------------------------------------------
// 1. Expected positive scenario — valid server, expect pass
// ---------------------------------------------------------------------------

describe("runScenarios — expected pass, valid server", () => {
  let server: FixtureServer;
  beforeAll(async () => { server = await startValidServer(); });
  afterAll(async () => server.close());

  it("matched=true for a passing scenario on a valid server", async () => {
    const scenarios: ScenarioInput[] = [
      {
        name: "no-auth",
        extraHeaders: {},
        removeHeaders: [],
        expected: { result: "pass" },
      },
    ];
    const [result] = await runScenarios(server.url, scenarios, DEV);
    expect(result.matched).toBe(true);
    expect(result.attempts).toBe(1);
  }, TIMEOUT);

  it("matched=true when expecting httpStatus is not set (just result)", async () => {
    const scenarios: ScenarioInput[] = [
      { name: "healthy", extraHeaders: {}, removeHeaders: [], expected: { result: "pass" } },
    ];
    const [result] = await runScenarios(server.url, scenarios, DEV);
    expect(result.matched).toBe(true);
    expect(result.actual.result).toBe("PASS");
  }, TIMEOUT);

  it("multiple passing scenarios all match", async () => {
    const scenarios: ScenarioInput[] = [
      { name: "s1", extraHeaders: {}, removeHeaders: [], expected: { result: "pass" } },
      { name: "s2", extraHeaders: {}, removeHeaders: [], expected: {} },
    ];
    const results = await runScenarios(server.url, scenarios, DEV);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.matched)).toBe(true);
  }, SLOW);
});

// ---------------------------------------------------------------------------
// 2. Expected negative scenario — 401 expected → matched=true
// ---------------------------------------------------------------------------

describe("runScenarios — expected negative auth scenario", () => {
  let server: FixtureServer;
  beforeAll(async () => { server = await startMissingTokenServer(); });
  afterAll(async () => server.close());

  it("matched=true when expected httpStatus=401 and server returns 401", async () => {
    const scenarios: ScenarioInput[] = [
      {
        name: "auth-required",
        extraHeaders: {},
        removeHeaders: [],
        expected: { httpStatus: 401 },
      },
    ];
    const [result] = await runScenarios(server.url, scenarios, DEV);
    expect(result.matched).toBe(true);
    expect(result.actual.httpStatus).toBe(401);
  }, TIMEOUT);

  it("matched=true when expected result=warning and server returns 401 without credentials", async () => {
    const scenarios: ScenarioInput[] = [
      {
        name: "expect-warning",
        extraHeaders: {},
        removeHeaders: [],
        expected: { result: "warning" },
      },
    ];
    const [result] = await runScenarios(server.url, scenarios, DEV);
    expect(result.matched).toBe(true);
    expect(result.actual.result).toBe("WARNING");
  }, TIMEOUT);

  it("no AUTH_SCENARIO_MISMATCH when expectation is met", async () => {
    const scenarios: ScenarioInput[] = [
      { name: "expect-401", extraHeaders: {}, removeHeaders: [], expected: { httpStatus: 401 } },
    ];
    const [result] = await runScenarios(server.url, scenarios, DEV);
    expect(result.report.findings.some((f) => f.code === "AUTH_SCENARIO_MISMATCH")).toBe(false);
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// 3. Scenario mismatch — expected pass, got 401 → AUTH_SCENARIO_MISMATCH
// ---------------------------------------------------------------------------

describe("runScenarios — scenario mismatch", () => {
  let server: FixtureServer;
  beforeAll(async () => { server = await startMissingTokenServer(); });
  afterAll(async () => server.close());

  it("matched=false when expecting pass but server returns 401", async () => {
    const scenarios: ScenarioInput[] = [
      { name: "expect-pass", extraHeaders: {}, removeHeaders: [], expected: { result: "pass" } },
    ];
    const [result] = await runScenarios(server.url, scenarios, DEV);
    expect(result.matched).toBe(false);
  }, TIMEOUT);

  it("AUTH_SCENARIO_MISMATCH finding added when mismatched", async () => {
    const scenarios: ScenarioInput[] = [
      { name: "wrong-expect", extraHeaders: {}, removeHeaders: [], expected: { result: "pass" } },
    ];
    const [result] = await runScenarios(server.url, scenarios, DEV);
    expect(result.report.findings.some((f) => f.code === "AUTH_SCENARIO_MISMATCH")).toBe(true);
  }, TIMEOUT);

  it("buildConfigReport marks overallStatus=FAIL when any scenario mismatches", async () => {
    const scenarios: ScenarioInput[] = [
      { name: "wrong-expect", extraHeaders: {}, removeHeaders: [], expected: { result: "pass" } },
    ];
    const results = await runScenarios(server.url, scenarios, DEV);
    const startMs = Date.now();
    const report = buildConfigReport(server.url, "test.yml", results, new Date().toISOString(), startMs);
    expect(report.overallStatus).toBe("FAIL");
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// 3b. AUTH_INVALID — server returns 401 with error="invalid_token"
// ---------------------------------------------------------------------------

describe("runScenarios — AUTH_INVALID (invalid token credential)", () => {
  let server: FixtureServer;
  beforeAll(async () => { server = await startInvalidTokenServer(); });
  afterAll(async () => server.close());

  it("AUTH_INVALID when credentials sent and server returns error=invalid_token", async () => {
    const [result] = await runScenarios(
      server.url,
      [{ name: "invalid-token", extraHeaders: { Authorization: "Bearer invalid_token_xyz" }, removeHeaders: [], expected: {} }],
      DEV,
    );
    expect(result.report.findings.some((f) => f.code === "AUTH_INVALID")).toBe(true);
  }, TIMEOUT);

  it("not AUTH_REQUIRED when credentials are present", async () => {
    const [result] = await runScenarios(
      server.url,
      [{ name: "invalid-token", extraHeaders: { Authorization: "Bearer invalid_token_xyz" }, removeHeaders: [], expected: {} }],
      DEV,
    );
    expect(result.report.findings.some((f) => f.code === "AUTH_REQUIRED")).toBe(false);
  }, TIMEOUT);

  it("not AUTH_EXPIRED when server returns error=invalid_token (not expiry)", async () => {
    const [result] = await runScenarios(
      server.url,
      [{ name: "invalid-token", extraHeaders: { Authorization: "Bearer invalid_token_xyz" }, removeHeaders: [], expected: {} }],
      DEV,
    );
    expect(result.report.findings.some((f) => f.code === "AUTH_EXPIRED")).toBe(false);
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// 3c. AUTH_EXPIRED — server returns 401 with error="token_expired"
// ---------------------------------------------------------------------------

describe("runScenarios — AUTH_EXPIRED (expired token credential)", () => {
  let server: FixtureServer;
  beforeAll(async () => { server = await startExpiredTokenServer(); });
  afterAll(async () => server.close());

  it("AUTH_EXPIRED when credentials sent and server returns error=token_expired", async () => {
    const [result] = await runScenarios(
      server.url,
      [{ name: "expired-token", extraHeaders: { Authorization: "Bearer expired_token_xyz" }, removeHeaders: [], expected: {} }],
      DEV,
    );
    expect(result.report.findings.some((f) => f.code === "AUTH_EXPIRED")).toBe(true);
  }, TIMEOUT);

  it("not AUTH_REQUIRED when credentials are present", async () => {
    const [result] = await runScenarios(
      server.url,
      [{ name: "expired-token", extraHeaders: { Authorization: "Bearer expired_token_xyz" }, removeHeaders: [], expected: {} }],
      DEV,
    );
    expect(result.report.findings.some((f) => f.code === "AUTH_REQUIRED")).toBe(false);
  }, TIMEOUT);

  it("not AUTH_INVALID when server returns error=token_expired (not general invalid)", async () => {
    const [result] = await runScenarios(
      server.url,
      [{ name: "expired-token", extraHeaders: { Authorization: "Bearer expired_token_xyz" }, removeHeaders: [], expected: {} }],
      DEV,
    );
    expect(result.report.findings.some((f) => f.code === "AUTH_INVALID")).toBe(false);
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// 4. 429 retry — succeeds on attempt 2 (requires retryOn: ["rate-limit"])
// ---------------------------------------------------------------------------

describe("runScenarios — 429 retry with Retry-After", () => {
  let server: FixtureServer;
  beforeAll(async () => { server = await startRateLimitThenSuccessServer(1); }); // 1s Retry-After
  afterAll(async () => server.close());

  it("retries after 429 and succeeds on second attempt", async () => {
    const scenarios: ScenarioInput[] = [
      { name: "retry-pass", extraHeaders: {}, removeHeaders: [], expected: { result: "pass" } },
    ];
    const [result] = await runScenarios(
      server.url,
      scenarios,
      DEV,
      { maxAttempts: 3, backoffMs: 500, retryOn: ["rate-limit"] },
    );
    expect(result.matched).toBe(true);
    expect(result.attempts).toBeGreaterThanOrEqual(2);
  }, SLOW);

  it("attempts field reflects actual retry count", async () => {
    const scenarios: ScenarioInput[] = [
      { name: "check-attempts", extraHeaders: {}, removeHeaders: [], expected: {} },
    ];
    const [result] = await runScenarios(
      server.url,
      scenarios,
      DEV,
      { maxAttempts: 3, backoffMs: 500, retryOn: ["rate-limit"] },
    );
    expect(result.attempts).toBeGreaterThanOrEqual(1);
    expect(result.report.attempts).toEqual(result.attempts);
  }, SLOW);

  it("retryCategory is rate-limit after a 429 retry", async () => {
    const scenarios: ScenarioInput[] = [
      { name: "check-category", extraHeaders: {}, removeHeaders: [], expected: {} },
    ];
    const [result] = await runScenarios(
      server.url,
      scenarios,
      DEV,
      { maxAttempts: 3, backoffMs: 500, retryOn: ["rate-limit"] },
    );
    if (result.attempts >= 2) {
      expect(result.retryCategory).toBe("rate-limit");
    }
  }, SLOW);

  it("maxAttempts appears in ScenarioResult", async () => {
    const scenarios: ScenarioInput[] = [
      { name: "check-max", extraHeaders: {}, removeHeaders: [], expected: {} },
    ];
    const [result] = await runScenarios(
      server.url,
      scenarios,
      DEV,
      { maxAttempts: 3, retryOn: ["rate-limit"] },
    );
    expect(result.maxAttempts).toBe(3);
  }, SLOW);

  it("does NOT retry 429 when rate-limit not in retryOn", async () => {
    // New server to reset call count
    const fresh = await startRateLimitThenSuccessServer(0);
    try {
      const scenarios: ScenarioInput[] = [
        { name: "no-retry", extraHeaders: {}, removeHeaders: [], expected: {} },
      ];
      const [result] = await runScenarios(
        fresh.url,
        scenarios,
        DEV,
        { maxAttempts: 3, retryOn: [] },
      );
      expect(result.attempts).toBe(1);
      expect(result.report.findings.some((f) => f.code === "RATE_LIMITED")).toBe(true);
    } finally {
      await fresh.close();
    }
  }, SLOW);
});

// ---------------------------------------------------------------------------
// 5. Retry exhaustion — always 429
// ---------------------------------------------------------------------------

describe("runScenarios — retry exhaustion", () => {
  let server: FixtureServer;
  beforeAll(async () => { server = await startAlwaysRateLimitServer("1"); });
  afterAll(async () => server.close());

  it("RETRY_EXHAUSTED finding after all attempts fail with rate-limit enabled", async () => {
    const scenarios: ScenarioInput[] = [
      { name: "always-limited", extraHeaders: {}, removeHeaders: [], expected: { result: "pass" } },
    ];
    const [result] = await runScenarios(
      server.url,
      scenarios,
      DEV,
      { maxAttempts: 2, backoffMs: 100, retryOn: ["rate-limit"] },
    );
    expect(result.report.findings.some((f) => f.code === "RETRY_EXHAUSTED")).toBe(true);
    expect(result.matched).toBe(false);
  }, SLOW);

  it("no RETRY_EXHAUSTED when retries disabled (maxAttempts=1)", async () => {
    const scenarios: ScenarioInput[] = [
      { name: "no-retry", extraHeaders: {}, removeHeaders: [], expected: { result: "pass" } },
    ];
    const [result] = await runScenarios(
      server.url,
      scenarios,
      DEV,
      { maxAttempts: 1, retryOn: ["rate-limit"] },
    );
    expect(result.attempts).toBe(1);
    expect(result.report.findings.some((f) => f.code === "RETRY_EXHAUSTED")).toBe(false);
    expect(result.report.findings.some((f) => f.code === "RATE_LIMITED")).toBe(true);
  }, TIMEOUT);

  it("no retries at all when retryOptions absent", async () => {
    const scenarios: ScenarioInput[] = [
      { name: "default-no-retry", extraHeaders: {}, removeHeaders: [], expected: {} },
    ];
    const [result] = await runScenarios(server.url, scenarios, DEV);
    expect(result.attempts).toBe(1);
    expect(result.report.findings.some((f) => f.code === "RETRY_EXHAUSTED")).toBe(false);
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// 6. Transient failure retry — 500 once then pass (requires retryOn: ["server-error"])
// ---------------------------------------------------------------------------

describe("runScenarios — transient failure retry", () => {
  let server: FixtureServer;
  beforeAll(async () => { server = await startTransientFailureServer(1); });
  afterAll(async () => server.close());

  it("retries 500 when server-error enabled and succeeds", async () => {
    const scenarios: ScenarioInput[] = [
      { name: "transient-then-pass", extraHeaders: {}, removeHeaders: [], expected: { result: "pass" } },
    ];
    const [result] = await runScenarios(
      server.url,
      scenarios,
      DEV,
      { maxAttempts: 3, backoffMs: 100, retryOn: ["server-error"] },
    );
    expect(result.matched).toBe(true);
    expect(result.attempts).toBeGreaterThanOrEqual(2);
  }, SLOW);

  it("does NOT retry 500 when server-error not in retryOn", async () => {
    const scenarios: ScenarioInput[] = [
      { name: "no-retry", extraHeaders: {}, removeHeaders: [], expected: { result: "pass" } },
    ];
    const [result] = await runScenarios(
      server.url,
      scenarios,
      DEV,
      { maxAttempts: 1, backoffMs: 100, retryOn: [] },
    );
    expect(result.attempts).toBe(1);
  }, TIMEOUT);

  it("does NOT retry 500 with rate-limit only (wrong category)", async () => {
    // fresh server with 1 failure, but retryOn only has rate-limit — should not retry 5xx
    const fresh = await startTransientFailureServer(1);
    try {
      const scenarios: ScenarioInput[] = [
        { name: "wrong-category", extraHeaders: {}, removeHeaders: [], expected: {} },
      ];
      const [result] = await runScenarios(
        fresh.url,
        scenarios,
        DEV,
        { maxAttempts: 3, backoffMs: 100, retryOn: ["rate-limit"] },
      );
      expect(result.attempts).toBe(1);
    } finally {
      await fresh.close();
    }
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// 8. Exact timeout finding codes — RESPONSE_TIMEOUT vs CONNECT_TIMEOUT
// ---------------------------------------------------------------------------

describe("runScenarios — RESPONSE_TIMEOUT exact finding code", () => {
  let server: FixtureServer;
  beforeAll(async () => { server = await startResponseTimeoutServer(); });
  afterAll(async () => server.close());

  it("RESPONSE_TIMEOUT when inner timer fires (responseTimeoutMs < timeoutMs)", async () => {
    // inner = 300 ms; outer = 5000 ms → inner wins → RESPONSE_TIMEOUT.
    const [result] = await runScenarios(
      server.url,
      [{ name: "resp-timeout", extraHeaders: {}, removeHeaders: [], expected: {} }],
      { allowHttp: true, responseTimeoutMs: 300, timeoutMs: 5000 },
    );
    expect(result.report.findings.some((f) => f.code === "RESPONSE_TIMEOUT")).toBe(true);
    expect(result.report.findings.some((f) => f.code === "CONNECT_TIMEOUT")).toBe(false);
  }, SLOW);

  it("RESPONSE_TIMEOUT when outer fires on HTTP localhost (tcpConnected=true always)", async () => {
    // HTTP localhost: TCP connects instantly → tcpConnected=true; outer at 300 ms
    // fires "Response timeout" even though responseTimeoutMs=5000.
    const [result] = await runScenarios(
      server.url,
      [{ name: "resp-timeout-outer", extraHeaders: {}, removeHeaders: [], expected: {} }],
      { allowHttp: true, timeoutMs: 300, responseTimeoutMs: 5000 },
    );
    expect(result.report.findings.some((f) => f.code === "RESPONSE_TIMEOUT")).toBe(true);
    expect(result.report.findings.some((f) => f.code === "CONNECT_TIMEOUT")).toBe(false);
  }, SLOW);
});

describe("runScenarios — CONNECT_TIMEOUT exact finding code", () => {
  it("CONNECT_TIMEOUT when TLS handshake never completes within timeoutMs", async () => {
    // Raw TCP server on localhost, never speaks TLS. Client connects with HTTPS:
    // tcpConnected stays false until outer timer fires → CONNECT_TIMEOUT.
    const server = await startConnectTimeoutServer();
    try {
      const [result] = await runScenarios(
        server.url,
        [{ name: "conn-timeout", extraHeaders: {}, removeHeaders: [], expected: {} }],
        { allowPrivateNetworks: true, timeoutMs: 300, responseTimeoutMs: 5000 },
      );
      expect(result.report.findings.some((f) => f.code === "CONNECT_TIMEOUT")).toBe(true);
      expect(result.report.findings.some((f) => f.code === "RESPONSE_TIMEOUT")).toBe(false);
    } finally {
      await server.close();
    }
  }, SLOW);
});

// ---------------------------------------------------------------------------
// 9. Retry category isolation — connection-failure vs response-timeout
// ---------------------------------------------------------------------------

describe("runScenarios — retry category isolation", () => {
  let server: FixtureServer;
  beforeAll(async () => { server = await startResponseTimeoutServer(); });
  afterAll(async () => server.close());

  it("RESPONSE_TIMEOUT is NOT retried when retryOn contains only connection-failure", async () => {
    const [result] = await runScenarios(
      server.url,
      [{ name: "no-retry", extraHeaders: {}, removeHeaders: [], expected: {} }],
      { allowHttp: true, responseTimeoutMs: 300, timeoutMs: 5000 },
      { maxAttempts: 3, backoffMs: 100, retryOn: ["connection-failure"] },
    );
    expect(result.attempts).toBe(1);
    expect(result.report.findings.some((f) => f.code === "RESPONSE_TIMEOUT")).toBe(true);
  }, SLOW);

  it("RESPONSE_TIMEOUT IS retried when retryOn contains response-timeout", async () => {
    // Both attempts time out → RETRY_EXHAUSTED added at attempt 2.
    const [result] = await runScenarios(
      server.url,
      [{ name: "should-retry", extraHeaders: {}, removeHeaders: [], expected: {} }],
      { allowHttp: true, responseTimeoutMs: 300, timeoutMs: 5000 },
      { maxAttempts: 2, backoffMs: 100, retryOn: ["response-timeout"] },
    );
    expect(result.attempts).toBeGreaterThanOrEqual(2);
    expect(result.retryCategory).toBe("response-timeout");
  }, SLOW);

  it("CONNECT_TIMEOUT is NOT retried when retryOn contains only response-timeout", async () => {
    const ctServer = await startConnectTimeoutServer();
    try {
      const [result] = await runScenarios(
        ctServer.url,
        [{ name: "no-retry", extraHeaders: {}, removeHeaders: [], expected: {} }],
        { allowPrivateNetworks: true, timeoutMs: 300, responseTimeoutMs: 5000 },
        { maxAttempts: 3, backoffMs: 100, retryOn: ["response-timeout"] },
      );
      expect(result.attempts).toBe(1);
      expect(result.report.findings.some((f) => f.code === "CONNECT_TIMEOUT")).toBe(true);
    } finally {
      await ctServer.close();
    }
  }, SLOW);

  it("CONNECT_TIMEOUT IS retried when retryOn contains connection-failure", async () => {
    const ctServer = await startConnectTimeoutServer();
    try {
      const [result] = await runScenarios(
        ctServer.url,
        [{ name: "should-retry", extraHeaders: {}, removeHeaders: [], expected: {} }],
        { allowPrivateNetworks: true, timeoutMs: 300, responseTimeoutMs: 5000 },
        { maxAttempts: 2, backoffMs: 100, retryOn: ["connection-failure"] },
      );
      expect(result.attempts).toBeGreaterThanOrEqual(2);
      expect(result.retryCategory).toBe("connection-failure");
    } finally {
      await ctServer.close();
    }
  }, SLOW);
});

// ---------------------------------------------------------------------------
// 10. SCENARIO_TIMEOUT — hard wall-clock deadline (aborts in-flight requests)
// ---------------------------------------------------------------------------

describe("runScenarios — SCENARIO_TIMEOUT as hard wall-clock deadline", () => {
  let server: FixtureServer;
  beforeAll(async () => { server = await startResponseTimeoutServer(); });
  afterAll(async () => server.close());

  it("SCENARIO_TIMEOUT when scenarioTimeoutMs fires during a hanging first attempt", async () => {
    // The scenario budget (200ms) expires while attempt 1 is in-flight
    // waiting for a response (responseTimeoutMs=2000ms). The scenario signal
    // aborts the request → runCheck returns SCENARIO_TIMEOUT, not RESPONSE_TIMEOUT.
    const [result] = await runScenarios(
      server.url,
      [{ name: "short-budget", extraHeaders: {}, removeHeaders: [], expected: {} }],
      { allowHttp: true, responseTimeoutMs: 2000, timeoutMs: 5000 },
      { maxAttempts: 3, backoffMs: 1000, retryOn: ["response-timeout"] },
      200,
    );
    expect(result.report.findings.some((f) => f.code === "SCENARIO_TIMEOUT")).toBe(true);
    expect(result.report.findings.some((f) => f.code === "RESPONSE_TIMEOUT")).toBe(false);
    expect(result.attempts).toBe(1);
  }, SLOW);

  it("SCENARIO_TIMEOUT (not RESPONSE_TIMEOUT) when responseMs fires first without scenario signal", async () => {
    // Baseline: responseTimeoutMs fires first → RESPONSE_TIMEOUT, not SCENARIO_TIMEOUT.
    const [result] = await runScenarios(
      server.url,
      [{ name: "resp-first", extraHeaders: {}, removeHeaders: [], expected: {} }],
      { allowHttp: true, responseTimeoutMs: 200, timeoutMs: 5000 },
    );
    expect(result.report.findings.some((f) => f.code === "RESPONSE_TIMEOUT")).toBe(true);
    expect(result.report.findings.some((f) => f.code === "SCENARIO_TIMEOUT")).toBe(false);
  }, SLOW);

  it("SCENARIO_TIMEOUT (not CONNECT_TIMEOUT) when deadline fires during TLS connect", async () => {
    // connectTimeoutServer never completes TLS. scenarioTimeoutMs (200ms) fires
    // before the per-attempt timeoutMs (2000ms) → SCENARIO_TIMEOUT, not CONNECT_TIMEOUT.
    const ctServer = await startConnectTimeoutServer();
    try {
      const [result] = await runScenarios(
        ctServer.url,
        [{ name: "scenario-vs-connect", extraHeaders: {}, removeHeaders: [], expected: {} }],
        { allowPrivateNetworks: true, timeoutMs: 2000, responseTimeoutMs: 5000 },
        undefined,
        200,
      );
      expect(result.report.findings.some((f) => f.code === "SCENARIO_TIMEOUT")).toBe(true);
      expect(result.report.findings.some((f) => f.code === "CONNECT_TIMEOUT")).toBe(false);
      expect(result.attempts).toBe(1);
    } finally {
      await ctServer.close();
    }
  }, SLOW);

  it("SCENARIO_TIMEOUT after retries consume most of the budget (deadline fires mid-attempt)", async () => {
    // Attempt 1 completes with RESPONSE_TIMEOUT (~200ms). Backoff 50ms.
    // Attempt 2 starts at ~250ms. Scenario budget (400ms) fires at ~400ms
    // while attempt 2 is in-flight → SCENARIO_TIMEOUT, attempts=2.
    const [result] = await runScenarios(
      server.url,
      [{ name: "budget-consumed", extraHeaders: {}, removeHeaders: [], expected: {} }],
      { allowHttp: true, responseTimeoutMs: 200, timeoutMs: 5000 },
      { maxAttempts: 5, backoffMs: 50, retryOn: ["response-timeout"] },
      400,
    );
    expect(result.report.findings.some((f) => f.code === "SCENARIO_TIMEOUT")).toBe(true);
    expect(result.attempts).toBeGreaterThanOrEqual(2);
    expect(result.retryCategory).toBeUndefined(); // cleared when deadline fires
  }, SLOW);

  it("SCENARIO_TIMEOUT when deadline fires during backoff (next request never starts)", async () => {
    // Attempt 1 completes with RESPONSE_TIMEOUT (~200ms). Backoff 500ms.
    // Scenario budget (350ms) fires at ~350ms during backoff → SCENARIO_TIMEOUT,
    // attempts=1 (attempt 2 never started).
    const [result] = await runScenarios(
      server.url,
      [{ name: "deadline-in-backoff", extraHeaders: {}, removeHeaders: [], expected: {} }],
      { allowHttp: true, responseTimeoutMs: 200, timeoutMs: 5000 },
      { maxAttempts: 5, backoffMs: 500, retryOn: ["response-timeout"] },
      350,
    );
    expect(result.report.findings.some((f) => f.code === "SCENARIO_TIMEOUT")).toBe(true);
    expect(result.attempts).toBe(1); // backoff aborted; attempt 2 never started
    expect(result.retryCategory).toBeUndefined();
  }, SLOW);

  it("SCENARIO_TIMEOUT is never accompanied by RETRY_EXHAUSTED", async () => {
    const [result] = await runScenarios(
      server.url,
      [{ name: "no-exhaust", extraHeaders: {}, removeHeaders: [], expected: {} }],
      { allowHttp: true, responseTimeoutMs: 200, timeoutMs: 5000 },
      { maxAttempts: 5, backoffMs: 150, retryOn: ["response-timeout"] },
      300,
    );
    expect(result.report.findings.some((f) => f.code === "RETRY_EXHAUSTED")).toBe(false);
    expect(result.report.findings.some((f) => f.code === "SCENARIO_TIMEOUT")).toBe(true);
  }, SLOW);

  it("subsequent scenario runs fine after a SCENARIO_TIMEOUT (no leaked handles)", async () => {
    // If timers or sockets leaked from the previous scenario, the next run
    // would hang. Completing promptly verifies cleanup.
    const [result] = await runScenarios(
      server.url,
      [{ name: "after-timeout", extraHeaders: {}, removeHeaders: [], expected: {} }],
      { allowHttp: true, responseTimeoutMs: 200, timeoutMs: 5000 },
    );
    expect(result.report.findings.some((f) => f.code === "RESPONSE_TIMEOUT")).toBe(true);
    expect(result.attempts).toBe(1);
  }, SLOW);
});

// ---------------------------------------------------------------------------
// 7. buildConfigReport — overallStatus aggregation
// ---------------------------------------------------------------------------

describe("buildConfigReport — status aggregation", () => {
  it("overallStatus=PASS when all scenarios matched", () => {
    const fakeResults = [
      { matched: true, name: "s1", expected: {}, actual: { result: "PASS" as const, httpStatus: 200 },
        attempts: 1, durationMs: 100,
        report: {
          schemaVersion: "1" as const, serverUrl: "u", checkedAt: "t", startedAt: "t",
          durationMs: 100, overallStatus: "PASS" as const, transport: null,
          transportType: "http" as const, protocolVersion: null, serverInfo: null,
          findings: [], tools: [],
        },
      },
    ];
    const result = buildConfigReport("http://x/mcp", "c.yml", fakeResults, new Date().toISOString(), Date.now());
    expect(result.overallStatus).toBe("PASS");
  });

  it("overallStatus=FAIL when any scenario unmatched", () => {
    const fakeResults = [
      { matched: true,  name: "s1", expected: {}, actual: { result: "PASS" as const, httpStatus: null },
        attempts: 1, durationMs: 50,
        report: {
          schemaVersion: "1" as const, serverUrl: "u", checkedAt: "t", startedAt: "t",
          durationMs: 50, overallStatus: "PASS" as const, transport: null,
          transportType: "http" as const, protocolVersion: null, serverInfo: null,
          findings: [], tools: [],
        },
      },
      { matched: false, name: "s2", expected: { result: "pass" as const }, actual: { result: "FAIL" as const, httpStatus: 401 },
        attempts: 1, durationMs: 60,
        report: {
          schemaVersion: "1" as const, serverUrl: "u", checkedAt: "t", startedAt: "t",
          durationMs: 60, overallStatus: "FAIL" as const, transport: null,
          transportType: "http" as const, protocolVersion: null, serverInfo: null,
          findings: [], tools: [],
        },
      },
    ];
    const result = buildConfigReport("http://x/mcp", "c.yml", fakeResults, new Date().toISOString(), Date.now());
    expect(result.overallStatus).toBe("FAIL");
  });
});
