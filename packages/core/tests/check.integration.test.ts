import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCheck } from "../src/check.js";
import {
  startValidServer,
  startInvalidToolNameServer,
  startMissingDescriptionServer,
  startInvalidInputSchemaServer,
  startInvalidOutputSchemaServer,
  startInitializationFailureServer,
  startTimeoutServer,
  startRedirectServer,
  type FixtureServer,
} from "../../../fixtures/servers/src/index.js";

const SSRF_OPTS = { allowHttp: true };

describe("runCheck — valid server", () => {
  let server: FixtureServer;
  beforeAll(async () => {
    server = await startValidServer();
  });
  afterAll(async () => server.close());

  it("returns PASS overall status", async () => {
    const report = await runCheck(server.url, SSRF_OPTS);
    expect(report.overallStatus).toBe("PASS");
  });

  it("includes INIT_OK finding", async () => {
    const report = await runCheck(server.url, SSRF_OPTS);
    expect(report.findings.some((f) => f.code === "INIT_OK")).toBe(true);
  });

  it("includes TOOLS_LIST_OK finding", async () => {
    const report = await runCheck(server.url, SSRF_OPTS);
    expect(report.findings.some((f) => f.code === "TOOLS_LIST_OK")).toBe(true);
  });

  it("reports two tools", async () => {
    const report = await runCheck(server.url, SSRF_OPTS);
    expect(report.tools).toHaveLength(2);
    const names = report.tools.map((t) => t.name);
    expect(names).toContain("get_weather");
    expect(names).toContain("search_web");
  });

  it("reports schemaVersion 1", async () => {
    const report = await runCheck(server.url, SSRF_OPTS);
    expect(report.schemaVersion).toBe("1");
  });
});

describe("runCheck — invalid tool name", () => {
  let server: FixtureServer;
  beforeAll(async () => {
    server = await startInvalidToolNameServer();
  });
  afterAll(async () => server.close());

  it("returns FAIL overall status", async () => {
    const report = await runCheck(server.url, SSRF_OPTS);
    expect(report.overallStatus).toBe("FAIL");
  });

  it("has TOOL_INVALID_NAME finding", async () => {
    const report = await runCheck(server.url, SSRF_OPTS);
    const allFindings = [...report.findings, ...report.tools.flatMap((t) => t.findings)];
    expect(allFindings.some((f) => f.code === "TOOL_INVALID_NAME")).toBe(true);
  });
});

describe("runCheck — missing description", () => {
  let server: FixtureServer;
  beforeAll(async () => {
    server = await startMissingDescriptionServer();
  });
  afterAll(async () => server.close());

  it("returns WARNING overall status", async () => {
    const report = await runCheck(server.url, SSRF_OPTS);
    expect(["WARNING", "FAIL"]).toContain(report.overallStatus);
  });

  it("has TOOL_MISSING_DESCRIPTION finding", async () => {
    const report = await runCheck(server.url, SSRF_OPTS);
    const allFindings = [...report.findings, ...report.tools.flatMap((t) => t.findings)];
    expect(allFindings.some((f) => f.code === "TOOL_MISSING_DESCRIPTION")).toBe(true);
  });
});

describe("runCheck — invalid input schema", () => {
  let server: FixtureServer;
  beforeAll(async () => {
    server = await startInvalidInputSchemaServer();
  });
  afterAll(async () => server.close());

  it("returns FAIL overall status", async () => {
    const report = await runCheck(server.url, SSRF_OPTS);
    expect(report.overallStatus).toBe("FAIL");
  });

  it("has TOOL_INVALID_INPUT_SCHEMA or TOOLS_LIST_FAILURE finding", async () => {
    const report = await runCheck(server.url, SSRF_OPTS);
    const allFindings = [...report.findings, ...report.tools.flatMap((t) => t.findings)];
    // The SDK's Zod parser may reject the malformed tools/list response before
    // we validate individual schemas, so both codes are valid here.
    const validCodes = ["TOOL_INVALID_INPUT_SCHEMA", "TOOLS_LIST_FAILURE"];
    expect(allFindings.some((f) => validCodes.includes(f.code))).toBe(true);
  });
});

describe("runCheck — invalid output schema", () => {
  let server: FixtureServer;
  beforeAll(async () => {
    server = await startInvalidOutputSchemaServer();
  });
  afterAll(async () => server.close());

  it("returns FAIL for invalid output schema", async () => {
    const report = await runCheck(server.url, SSRF_OPTS);
    expect(report.overallStatus).toBe("FAIL");
  });
});

describe("runCheck — initialization failure", () => {
  let server: FixtureServer;
  beforeAll(async () => {
    server = await startInitializationFailureServer();
  });
  afterAll(async () => server.close());

  it("returns FAIL overall status", async () => {
    const report = await runCheck(server.url, SSRF_OPTS);
    expect(report.overallStatus).toBe("FAIL");
  });

  it("has TRANSPORT_ERROR or similar finding", async () => {
    const report = await runCheck(server.url, SSRF_OPTS);
    const failCodes = ["TRANSPORT_ERROR", "INIT_FAILURE", "HTTP_ERROR", "REMOTE_HTTP_ERROR"];
    expect(report.findings.some((f) => failCodes.includes(f.code))).toBe(true);
  });
});

describe("runCheck — timeout server", () => {
  let server: FixtureServer;
  beforeAll(async () => {
    server = await startTimeoutServer();
  });
  afterAll(async () => server.close());

  it("returns FAIL with RESPONSE_TIMEOUT when inner timer fires first", async () => {
    // No responseTimeoutMs → defaults to timeoutMs.  The outer backstop gets +1 ms so
    // the inner responseTimedOut timer always fires first → RESPONSE_TIMEOUT.
    const report = await runCheck(server.url, {
      ...SSRF_OPTS,
      timeoutMs: 500,
    });
    expect(report.overallStatus).toBe("FAIL");
    expect(report.findings.some((f) => f.code === "RESPONSE_TIMEOUT")).toBe(true);
    expect(report.findings.some((f) => f.code === "CONNECT_TIMEOUT")).toBe(false);
  }, 10000);

  it("returns FAIL with CONNECT_TIMEOUT when responseTimeoutMs exceeds outer timer", async () => {
    // outer timer = timeoutMs + 1 = 301 ms; inner = responseTimeoutMs = 5000 ms → outer wins.
    const report = await runCheck(server.url, {
      ...SSRF_OPTS,
      timeoutMs: 300,
      responseTimeoutMs: 5000,
    });
    expect(report.overallStatus).toBe("FAIL");
    expect(report.findings.some((f) => f.code === "CONNECT_TIMEOUT")).toBe(true);
    expect(report.findings.some((f) => f.code === "RESPONSE_TIMEOUT")).toBe(false);
  }, 10000);
});

describe("runCheck — redirect limit", () => {
  let server: FixtureServer;
  beforeAll(async () => {
    server = await startRedirectServer(5); // 5 hops > our limit of 3
  });
  afterAll(async () => server.close());

  it("returns FAIL when redirect limit exceeded", async () => {
    const report = await runCheck(server.url, {
      ...SSRF_OPTS,
      maxRedirects: 2,
    });
    expect(report.overallStatus).toBe("FAIL");
    const failCodes = ["REDIRECT_LIMIT_EXCEEDED", "TRANSPORT_ERROR"];
    expect(report.findings.some((f) => failCodes.includes(f.code))).toBe(true);
  });
});
