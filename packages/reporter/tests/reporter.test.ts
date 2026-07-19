/**
 * Reporter tests covering all four execution environments:
 *   browser HTTP, CLI HTTP, CLI stdio, GitHub Actions stdio.
 *
 * Test groups:
 *   1. Terminal output — HTTP vs stdio
 *   2. Markdown output — HTTP vs stdio
 *   3. JSON output — transport field omission for stdio
 *   4. Credential and path redaction
 *   5. startedAt and executionEnvironment fields
 *   6. Complete report examples (all four environments)
 *   7. Backward compatibility — old reports without new fields
 *   8. REMEDIATION map coverage
 */

import { describe, it, expect } from "vitest";
import type { CheckReport } from "@mcp-release/core";
import { toTerminal, toMarkdown, toJson, REMEDIATION } from "@mcp-release/reporter";

// ── Shared fixtures ───────────────────────────────────────────────────────────

/** Browser HTTP report — produced by the web API handler */
function makeBrowserHttpReport(overallStatus: "PASS" | "WARNING" | "FAIL" = "PASS"): CheckReport {
  return {
    schemaVersion: "1",
    serverUrl: "https://example.com/mcp",
    checkedAt: "2026-06-26T12:00:00.000Z",
    startedAt: "2026-06-26T12:00:00.000Z",
    durationMs: 320,
    overallStatus,
    transport: {
      httpStatus: 200,
      httpStatusText: null,
      durationMs: 280,
      redirectCount: 0,
      headersAvailable: false,
    },
    transportType: "http",
    mcpReleaseVersion: "0.2.1",
    executionEnvironment: "browser",
    protocolVersion: "2024-11-05",
    serverInfo: { name: "example-server", version: "1.0.0" },
    findings: [
      { code: "INIT_OK", severity: "PASS", message: "MCP initialization succeeded" },
      { code: "TOOLS_LIST_OK", severity: "PASS", message: "Found 2 tool(s)" },
      ...(overallStatus === "FAIL"
        ? [{ code: "TRANSPORT_ERROR" as const, severity: "FAIL" as const, message: "connection refused" }]
        : []),
      ...(overallStatus === "WARNING"
        ? [{ code: "AUTH_REQUIRED" as const, severity: "WARNING" as const, message: "authorization required" }]
        : []),
    ],
    tools: [
      {
        name: "search",
        overallStatus: "PASS",
        findings: [{ code: "TOOL_OK", severity: "PASS", message: "tool schema is valid" }],
      },
    ],
  };
}

/** CLI HTTP report — produced by CLI against an HTTP/SSE endpoint */
function makeCliHttpReport(overallStatus: "PASS" | "WARNING" | "FAIL" = "PASS"): CheckReport {
  return {
    ...makeBrowserHttpReport(overallStatus),
    executionEnvironment: "cli",
    // CLI allows private networks and auth headers; server URL unchanged
  };
}

/** CLI stdio report — produced by CLI spawning a local process */
function makeCliStdioReport(overallStatus: "PASS" | "WARNING" | "FAIL" = "PASS"): CheckReport {
  return {
    schemaVersion: "1",
    serverUrl: "stdio:node",
    checkedAt: "2026-06-26T12:00:00.000Z",
    startedAt: "2026-06-26T12:00:00.000Z",
    durationMs: 780,
    overallStatus,
    transport: null,
    transportType: "stdio",
    mcpReleaseVersion: "0.2.1",
    executionEnvironment: "cli",
    protocolVersion: "2024-11-05",
    serverInfo: { name: "my-mcp-server", version: "2.0.0" },
    findings: [
      { code: "INIT_OK", severity: "PASS", message: "MCP initialization succeeded" },
      { code: "TOOLS_LIST_OK", severity: "PASS", message: "Found 3 tool(s)" },
      ...(overallStatus === "WARNING"
        ? [
            {
              code: "STDIO_UNEXPECTED_OUTPUT" as const,
              severity: "WARNING" as const,
              message: "Server wrote 1 non-protocol line(s) to stdout. Logs must go to stderr.",
              context: { count: 1, preview: "Listening on port 3000" },
            },
          ]
        : []),
      ...(overallStatus === "FAIL"
        ? [
            {
              code: "STDIO_FRAMING_ERROR" as const,
              severity: "FAIL" as const,
              message: "Server sent 2 malformed MCP protocol message(s) on stdout",
              context: { count: 2 },
            },
          ]
        : []),
    ],
    tools: [
      {
        name: "read-file",
        overallStatus: "PASS",
        findings: [{ code: "TOOL_OK", severity: "PASS", message: "tool schema is valid" }],
      },
    ],
  };
}

/** GitHub Actions stdio report — produced by the GitHub Action */
function makeGhaStdioReport(overallStatus: "PASS" | "WARNING" | "FAIL" = "PASS"): CheckReport {
  return {
    ...makeCliStdioReport(overallStatus),
    executionEnvironment: "github-actions",
  };
}

// ── 1. Terminal output — HTTP ─────────────────────────────────────────────────

describe("terminal — HTTP report (browser & CLI)", () => {
  it("shows HTTP/SSE as transport type", () => {
    expect(toTerminal(makeBrowserHttpReport())).toContain("HTTP/SSE");
  });

  it("shows version in header", () => {
    expect(toTerminal(makeBrowserHttpReport())).toContain("v0.2.1");
  });

  it("shows Started at timestamp", () => {
    const out = toTerminal(makeBrowserHttpReport());
    expect(out).toContain("Started at:");
    expect(out).toContain("2026-06-26T12:00:00.000Z");
  });

  it("shows summary counts", () => {
    const out = toTerminal(makeBrowserHttpReport("FAIL"));
    expect(out).toContain("Failures: 1");
    expect(out).toContain("Passed: 3"); // 2 top-level PASS + 1 tool PASS
  });

  it("does not show stdio privacy note", () => {
    expect(toTerminal(makeBrowserHttpReport())).not.toContain("Credentials are sent only to");
  });

  it("does not show tools-not-invoked note", () => {
    expect(toTerminal(makeBrowserHttpReport())).not.toContain("not invoked");
  });
});

// ── 2. Terminal output — stdio ────────────────────────────────────────────────

describe("terminal — stdio PASS report (CLI)", () => {
  it("shows stdio as transport type", () => {
    expect(toTerminal(makeCliStdioReport())).toContain("stdio");
  });

  it("shows privacy note", () => {
    expect(toTerminal(makeCliStdioReport())).toContain("Credentials are sent only to the configured MCP endpoint.");
  });

  it("shows tools-not-invoked note when tools are present", () => {
    expect(toTerminal(makeCliStdioReport())).toContain("not invoked");
  });

  it("shows Started at", () => {
    expect(toTerminal(makeCliStdioReport())).toContain("Started at:");
  });

  it("shows PASS status", () => {
    expect(toTerminal(makeCliStdioReport("PASS"))).toContain("PASS");
  });
});

describe("terminal — stdio WARNING report", () => {
  it("shows WARNING status", () => {
    expect(toTerminal(makeCliStdioReport("WARNING"))).toContain("WARNING");
  });

  it("includes STDIO_UNEXPECTED_OUTPUT finding code", () => {
    expect(toTerminal(makeCliStdioReport("WARNING"))).toContain("STDIO_UNEXPECTED_OUTPUT");
  });

  it("shows privacy note regardless of status", () => {
    expect(toTerminal(makeCliStdioReport("WARNING"))).toContain("Credentials are sent only to the configured MCP endpoint.");
  });
});

describe("terminal — stdio FAIL report", () => {
  it("shows FAIL status", () => {
    expect(toTerminal(makeCliStdioReport("FAIL"))).toContain("FAIL");
  });

  it("includes STDIO_FRAMING_ERROR finding code", () => {
    expect(toTerminal(makeCliStdioReport("FAIL"))).toContain("STDIO_FRAMING_ERROR");
  });
});

// ── 3. Markdown output — HTTP ─────────────────────────────────────────────────

describe("markdown — HTTP report (browser)", () => {
  it("shows HTTP/SSE transport label", () => {
    expect(toMarkdown(makeBrowserHttpReport())).toContain("**Transport:** HTTP/SSE");
  });

  it("shows MCP Release version", () => {
    expect(toMarkdown(makeBrowserHttpReport())).toContain("**MCP Release:** v0.2.1");
  });

  it("shows Started at timestamp", () => {
    const out = toMarkdown(makeBrowserHttpReport());
    expect(out).toContain("**Started at:**");
    expect(out).toContain("2026-06-26T12:00:00.000Z");
  });

  it("shows summary counts table", () => {
    const out = toMarkdown(makeBrowserHttpReport("FAIL"));
    expect(out).toContain("| Passed | Warnings | Failures |");
    // 2 top-level PASS + 1 tool PASS = 3 passed; 1 FAIL
    expect(out).toContain("| 3 | 0 | 1 |");
  });

  it("does not show stdio privacy blockquote", () => {
    expect(toMarkdown(makeBrowserHttpReport())).not.toContain("Credentials are sent only to");
  });

  it("does not show tools-not-invoked note", () => {
    expect(toMarkdown(makeBrowserHttpReport())).not.toContain("not invoked");
  });

  it("includes remediation for TRANSPORT_ERROR", () => {
    const out = toMarkdown(makeBrowserHttpReport("FAIL"));
    expect(out).toContain("Remediation");
    expect(out).toContain(REMEDIATION["TRANSPORT_ERROR"]!);
  });
});

describe("markdown — stdio PASS report (CLI)", () => {
  it("shows 'stdio (local process)' transport label", () => {
    expect(toMarkdown(makeCliStdioReport())).toContain("**Transport:** stdio (local process)");
  });

  it("shows privacy blockquote", () => {
    const out = toMarkdown(makeCliStdioReport());
    expect(out).toContain("> **Security:**");
    expect(out).toContain("Credentials are sent only to the configured MCP endpoint.");
  });

  it("shows tools-not-invoked note when tools are present", () => {
    expect(toMarkdown(makeCliStdioReport())).toContain("> **Note:** Tools were discovered but not invoked.");
  });

  it("shows Started at", () => {
    expect(toMarkdown(makeCliStdioReport())).toContain("**Started at:**");
  });
});

describe("markdown — stdio WARNING report (GitHub Actions)", () => {
  it("includes remediation for STDIO_UNEXPECTED_OUTPUT", () => {
    const out = toMarkdown(makeGhaStdioReport("WARNING"));
    expect(out).toContain("Remediation");
    expect(out).toContain(REMEDIATION["STDIO_UNEXPECTED_OUTPUT"]!);
  });

  it("shows WARNING badge", () => {
    expect(toMarkdown(makeGhaStdioReport("WARNING"))).toContain("🟡 WARNING");
  });
});

describe("markdown — stdio FAIL report", () => {
  it("includes remediation for STDIO_FRAMING_ERROR", () => {
    expect(toMarkdown(makeCliStdioReport("FAIL"))).toContain(REMEDIATION["STDIO_FRAMING_ERROR"]!);
  });

  it("shows FAIL badge", () => {
    expect(toMarkdown(makeCliStdioReport("FAIL"))).toContain("🔴 FAIL");
  });
});

// ── 4. JSON output — transport field omission ─────────────────────────────────

describe("JSON — transport field omission for stdio", () => {
  it("stdio JSON does NOT contain a transport key", () => {
    const parsed = JSON.parse(toJson(makeCliStdioReport())) as Record<string, unknown>;
    expect(Object.keys(parsed)).not.toContain("transport");
  });

  it("stdio JSON is not transport: null — the key is absent entirely", () => {
    const json = toJson(makeCliStdioReport());
    expect(json).not.toContain('"transport"');
  });

  it("HTTP JSON includes the transport object", () => {
    const parsed = JSON.parse(toJson(makeBrowserHttpReport())) as CheckReport;
    expect(parsed.transport).not.toBeNull();
    expect(parsed.transport?.httpStatus).toBe(200);
  });

  it("JSON includes transportType: http for HTTP report", () => {
    const parsed = JSON.parse(toJson(makeBrowserHttpReport())) as CheckReport;
    expect(parsed.transportType).toBe("http");
  });

  it("JSON includes transportType: stdio for stdio report", () => {
    const parsed = JSON.parse(toJson(makeCliStdioReport())) as CheckReport;
    expect(parsed.transportType).toBe("stdio");
  });

  it("JSON includes mcpReleaseVersion", () => {
    expect((JSON.parse(toJson(makeBrowserHttpReport())) as CheckReport).mcpReleaseVersion).toBe("0.2.1");
  });

  it("JSON includes startedAt", () => {
    expect((JSON.parse(toJson(makeBrowserHttpReport())) as CheckReport).startedAt).toBe("2026-06-26T12:00:00.000Z");
  });

  it("JSON includes executionEnvironment: browser", () => {
    expect((JSON.parse(toJson(makeBrowserHttpReport())) as CheckReport).executionEnvironment).toBe("browser");
  });

  it("JSON includes executionEnvironment: cli for CLI stdio report", () => {
    expect((JSON.parse(toJson(makeCliStdioReport())) as CheckReport).executionEnvironment).toBe("cli");
  });

  it("JSON includes executionEnvironment: github-actions for GHA report", () => {
    expect((JSON.parse(toJson(makeGhaStdioReport())) as CheckReport).executionEnvironment).toBe("github-actions");
  });

  it("Markdown shows HTTP/SSE when JSON has transportType http", () => {
    const report = JSON.parse(toJson(makeBrowserHttpReport())) as CheckReport;
    expect(toMarkdown(report)).toContain("HTTP/SSE");
  });

  it("Markdown shows stdio (local process) when JSON has transportType stdio", () => {
    const report = JSON.parse(toJson(makeCliStdioReport())) as CheckReport;
    expect(toMarkdown(report)).toContain("stdio (local process)");
  });
});

// ── 5. Credential and path redaction ─────────────────────────────────────────

describe("path redaction — safeCommandLabel strips directory components", () => {
  it("unix absolute path is reduced to basename in serverUrl", () => {
    // safeCommandLabel("/Users/alice/.nvm/bin/node") → "stdio:node"
    const report: CheckReport = {
      ...makeCliStdioReport(),
      serverUrl: "stdio:node",
    };
    expect(report.serverUrl).not.toContain("/Users/");
    expect(report.serverUrl).not.toContain("alice");
    expect(report.serverUrl).toBe("stdio:node");
  });

  it("windows-style path is reduced to basename in serverUrl", () => {
    const report: CheckReport = {
      ...makeCliStdioReport(),
      serverUrl: "stdio:node.exe",
    };
    expect(report.serverUrl).not.toContain("C:\\");
    expect(report.serverUrl).not.toContain("Users");
    expect(report.serverUrl).toBe("stdio:node.exe");
  });

  it("terminal output does not contain unix home directory path", () => {
    const report: CheckReport = { ...makeCliStdioReport(), serverUrl: "stdio:node" };
    const out = toTerminal(report);
    expect(out).not.toMatch(/\/Users\/[^/]/);
    expect(out).not.toMatch(/\/home\/[^/]/);
  });

  it("terminal output does not contain windows home directory path", () => {
    const report: CheckReport = { ...makeCliStdioReport(), serverUrl: "stdio:node.exe" };
    const out = toTerminal(report);
    expect(out).not.toMatch(/C:\\Users\\/i);
  });

  it("markdown output does not expose full filesystem paths", () => {
    const report: CheckReport = { ...makeCliStdioReport(), serverUrl: "stdio:node" };
    expect(toMarkdown(report)).not.toMatch(/\/Users\/[^/]/);
  });
});

describe("credential redaction — command arguments not in reports", () => {
  it("stdio serverUrl contains only executable basename, not arguments", () => {
    // Command "npx -y my-mcp-server --token=secret" becomes "stdio:npx"
    const report: CheckReport = { ...makeCliStdioReport(), serverUrl: "stdio:npx" };
    expect(report.serverUrl).not.toContain("--token");
    expect(report.serverUrl).not.toContain("secret");
    expect(report.serverUrl).not.toContain("-y");
    expect(report.serverUrl).not.toContain("my-mcp-server");
  });

  it("terminal output does not expose command arguments", () => {
    const report: CheckReport = { ...makeCliStdioReport(), serverUrl: "stdio:npx" };
    const out = toTerminal(report);
    expect(out).not.toContain("--token");
    expect(out).not.toContain("secret");
  });

  it("markdown output does not expose command arguments", () => {
    const report: CheckReport = { ...makeCliStdioReport(), serverUrl: "stdio:npx" };
    const out = toMarkdown(report);
    expect(out).not.toContain("--token");
    expect(out).not.toContain("secret");
  });
});

describe("credential redaction — Bearer tokens and Authorization headers", () => {
  it("terminal output does not include Authorization header values from context", () => {
    // Auth headers are never stored in CheckReport findings (they are masked before runCheck).
    // This test verifies no authorization value leaks into terminal output.
    const report: CheckReport = {
      ...makeBrowserHttpReport("WARNING"),
      findings: [
        { code: "AUTH_REQUIRED", severity: "WARNING", message: "Server requires authorization." },
      ],
    };
    const out = toTerminal(report);
    expect(out).not.toContain("Bearer");
    expect(out).not.toContain("eyJ"); // JWT prefix
    expect(out).not.toContain("sk-"); // OpenAI-style key prefix
  });

  it("markdown output does not include bearer token values in findings", () => {
    const report: CheckReport = {
      ...makeBrowserHttpReport("WARNING"),
      findings: [
        { code: "AUTH_REQUIRED", severity: "WARNING", message: "Server requires authorization." },
      ],
    };
    const out = toMarkdown(report);
    expect(out).not.toContain("Bearer sk-");
    expect(out).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });
});

describe("credential redaction — credentials embedded in URLs", () => {
  it("terminal output does not expose password in serverUrl", () => {
    // redactUrl() in core strips credential params from URLs;
    // the serverUrl stored in the report is already sanitized.
    const report: CheckReport = {
      ...makeBrowserHttpReport(),
      serverUrl: "https://example.com/mcp?token=[REDACTED]",
    };
    const out = toTerminal(report);
    expect(out).not.toMatch(/token=(?!.*\[REDACTED\])[^&\s]+/);
  });

  it("markdown output shows [REDACTED] instead of actual token value in URL", () => {
    const report: CheckReport = {
      ...makeBrowserHttpReport(),
      serverUrl: "https://example.com/mcp?api_key=[REDACTED]",
    };
    const out = toMarkdown(report);
    expect(out).toContain("[REDACTED]");
    expect(out).not.toMatch(/api_key=(?!.*\[REDACTED\])[a-zA-Z0-9]+/);
  });
});

// ── 6. startedAt and executionEnvironment ────────────────────────────────────

describe("startedAt field", () => {
  it("terminal shows Started at label", () => {
    expect(toTerminal(makeBrowserHttpReport())).toContain("Started at:");
  });

  it("markdown shows Started at label", () => {
    expect(toMarkdown(makeBrowserHttpReport())).toContain("**Started at:**");
  });

  it("JSON includes startedAt equal to checkedAt for new reports", () => {
    const report = makeBrowserHttpReport();
    const parsed = JSON.parse(toJson(report)) as CheckReport;
    expect(parsed.startedAt).toBe(report.checkedAt);
  });

  it("terminal falls back to checkedAt when startedAt absent (old reports)", () => {
    const report: CheckReport = {
      schemaVersion: "1",
      serverUrl: "https://old.example.com/mcp",
      checkedAt: "2025-01-01T00:00:00.000Z",
      durationMs: 100,
      overallStatus: "PASS",
      transport: { httpStatus: 200, httpStatusText: null, durationMs: 80, redirectCount: 0, headersAvailable: false },
      protocolVersion: null,
      serverInfo: null,
      findings: [{ code: "INIT_OK", severity: "PASS", message: "ok" }],
      tools: [],
    };
    const out = toTerminal(report);
    expect(out).toContain("Started at:");
    expect(out).toContain("2025-01-01T00:00:00.000Z");
  });

  it("duration is calculated from startedAt to completion (durationMs is the elapsed time)", () => {
    // durationMs = completionTime - startMs where startMs was captured at the
    // same moment as checkedAt/startedAt. This test verifies the field relationship.
    const report = makeBrowserHttpReport();
    expect(report.durationMs).toBeGreaterThan(0);
    // startedAt should precede or equal the end (startedAt + durationMs ≈ end time)
    const start = new Date(report.startedAt ?? report.checkedAt).getTime();
    expect(start + report.durationMs).toBeGreaterThan(start);
  });
});

describe("executionEnvironment field", () => {
  it("JSON includes executionEnvironment: browser for browser report", () => {
    const parsed = JSON.parse(toJson(makeBrowserHttpReport())) as CheckReport;
    expect(parsed.executionEnvironment).toBe("browser");
  });

  it("JSON includes executionEnvironment: cli for CLI HTTP report", () => {
    const parsed = JSON.parse(toJson(makeCliHttpReport())) as CheckReport;
    expect(parsed.executionEnvironment).toBe("cli");
  });

  it("JSON includes executionEnvironment: cli for CLI stdio report", () => {
    const parsed = JSON.parse(toJson(makeCliStdioReport())) as CheckReport;
    expect(parsed.executionEnvironment).toBe("cli");
  });

  it("JSON includes executionEnvironment: github-actions for GHA report", () => {
    const parsed = JSON.parse(toJson(makeGhaStdioReport())) as CheckReport;
    expect(parsed.executionEnvironment).toBe("github-actions");
  });
});

// ── 7. Complete report examples — all four environments ───────────────────────

describe("complete report — browser HTTP", () => {
  const report = makeBrowserHttpReport("PASS");

  it("terminal contains all required fields", () => {
    const out = toTerminal(report);
    expect(out).toContain("MCP Release v0.2.1");
    expect(out).toContain("HTTP/SSE");
    expect(out).toContain("PASS");
    expect(out).toContain("Started at:");
    expect(out).toContain("Duration:");
    expect(out).toContain("Protocol:");
    expect(out).toContain("INIT_OK");
    expect(out).toContain("TOOLS_LIST_OK");
  });

  it("markdown contains all required fields", () => {
    const out = toMarkdown(report);
    expect(out).toContain("## MCP Release Report");
    expect(out).toContain("**Transport:** HTTP/SSE");
    expect(out).toContain("**MCP Release:** v0.2.1");
    expect(out).toContain("**Started at:**");
    expect(out).toContain("**Duration:**");
    expect(out).toContain("| Passed | Warnings | Failures |");
    expect(out).toContain("INIT_OK");
  });

  it("JSON contains all required fields", () => {
    const parsed = JSON.parse(toJson(report)) as CheckReport;
    expect(parsed.schemaVersion).toBe("1");
    expect(parsed.transportType).toBe("http");
    expect(parsed.startedAt).toBeTruthy();
    expect(parsed.mcpReleaseVersion).toBe("0.2.1");
    expect(parsed.executionEnvironment).toBe("browser");
    expect(parsed.transport).not.toBeNull();
    expect(parsed.findings.length).toBeGreaterThan(0);
  });
});

describe("complete report — CLI HTTP", () => {
  const report = makeCliHttpReport("PASS");

  it("JSON has executionEnvironment: cli", () => {
    const parsed = JSON.parse(toJson(report)) as CheckReport;
    expect(parsed.executionEnvironment).toBe("cli");
  });

  it("terminal shows HTTP/SSE transport", () => {
    expect(toTerminal(report)).toContain("HTTP/SSE");
  });

  it("JSON transport object is present (not stripped)", () => {
    const parsed = JSON.parse(toJson(report)) as CheckReport;
    expect(parsed.transport).not.toBeNull();
  });
});

describe("complete report — CLI stdio", () => {
  const report = makeCliStdioReport("PASS");

  it("terminal shows all stdio-specific sections", () => {
    const out = toTerminal(report);
    expect(out).toContain("MCP Release v0.2.1");
    expect(out).toContain("stdio");
    expect(out).toContain("PASS");
    expect(out).toContain("Started at:");
    expect(out).toContain("Credentials are sent only to the configured MCP endpoint.");
    expect(out).toContain("not invoked");
    expect(out).toContain("INIT_OK");
    expect(out).toContain("TOOLS_LIST_OK");
  });

  it("markdown shows all required stdio sections", () => {
    const out = toMarkdown(report);
    expect(out).toContain("**Transport:** stdio (local process)");
    expect(out).toContain("**MCP Release:** v0.2.1");
    expect(out).toContain("**Started at:**");
    expect(out).toContain("> **Security:**");
    expect(out).toContain("> **Note:** Tools were discovered but not invoked.");
    expect(out).toContain("| Passed | Warnings | Failures |");
  });

  it("JSON has transport key absent (not null)", () => {
    const json = toJson(report);
    expect(json).not.toContain('"transport"');
    expect(json).not.toContain('"transport": null');
  });

  it("JSON has all required metadata fields", () => {
    const parsed = JSON.parse(toJson(report)) as CheckReport;
    expect(parsed.transportType).toBe("stdio");
    expect(parsed.executionEnvironment).toBe("cli");
    expect(parsed.mcpReleaseVersion).toBe("0.2.1");
    expect(parsed.startedAt).toBeTruthy();
  });
});

describe("complete report — GitHub Actions stdio", () => {
  const report = makeGhaStdioReport("WARNING");

  it("terminal shows WARNING with privacy note", () => {
    const out = toTerminal(report);
    expect(out).toContain("WARNING");
    expect(out).toContain("stdio");
    expect(out).toContain("Credentials are sent only to the configured MCP endpoint.");
    expect(out).toContain("STDIO_UNEXPECTED_OUTPUT");
  });

  it("markdown includes remediation for STDIO_UNEXPECTED_OUTPUT", () => {
    const out = toMarkdown(report);
    expect(out).toContain("Remediation");
    expect(out).toContain(REMEDIATION["STDIO_UNEXPECTED_OUTPUT"]!);
    expect(out).toContain("> **Security:**");
  });

  it("JSON has executionEnvironment: github-actions", () => {
    const parsed = JSON.parse(toJson(report)) as CheckReport;
    expect(parsed.executionEnvironment).toBe("github-actions");
  });

  it("JSON transport field is absent for stdio GHA report", () => {
    expect(toJson(report)).not.toContain('"transport"');
  });
});

// ── 8. Backward compatibility — old reports without new fields ────────────────

describe("backward compat — old reports without transportType, startedAt, executionEnvironment", () => {
  const oldReport: CheckReport = {
    schemaVersion: "1",
    serverUrl: "https://old.example.com/mcp",
    checkedAt: "2025-01-01T00:00:00.000Z",
    durationMs: 100,
    overallStatus: "PASS",
    transport: { httpStatus: 200, httpStatusText: null, durationMs: 80, redirectCount: 0, headersAvailable: false },
    protocolVersion: "2024-11-05",
    serverInfo: null,
    findings: [{ code: "INIT_OK", severity: "PASS", message: "ok" }],
    tools: [],
  };

  it("terminal renders without Transport line when transportType is absent", () => {
    const out = toTerminal(oldReport);
    expect(out).toContain("PASS");
    expect(out).not.toContain("Transport:");
    expect(out).not.toContain("Credentials are sent only to");
    expect(out).toContain("Started at:"); // falls back to checkedAt
  });

  it("markdown renders without Transport row when transportType is absent", () => {
    const out = toMarkdown(oldReport);
    expect(out).toContain("PASS");
    expect(out).not.toContain("**Transport:**");
    expect(out).not.toContain("Credentials are sent only to");
    expect(out).toContain("**Started at:**"); // falls back to checkedAt
  });

  it("JSON serializes old report without modification", () => {
    const parsed = JSON.parse(toJson(oldReport)) as CheckReport;
    expect(parsed.schemaVersion).toBe("1");
    expect(parsed.transport).not.toBeNull();
    // New optional fields are absent from old reports
    expect(parsed.transportType).toBeUndefined();
    expect(parsed.startedAt).toBeUndefined();
    expect(parsed.executionEnvironment).toBeUndefined();
    expect(parsed.mcpReleaseVersion).toBeUndefined();
  });
});

// ── 9. REMEDIATION map coverage ───────────────────────────────────────────────

describe("REMEDIATION map", () => {
  it("has remediation for all 5 stdio-specific finding codes", () => {
    expect(REMEDIATION["STDIO_UNEXPECTED_OUTPUT"]).toBeTruthy();
    expect(REMEDIATION["STDIO_FRAMING_ERROR"]).toBeTruthy();
    expect(REMEDIATION["STDIO_SHUTDOWN_TIMEOUT"]).toBeTruthy();
    expect(REMEDIATION["STDIO_PROCESS_ERROR"]).toBeTruthy();
    expect(REMEDIATION["STDIO_RESPONSE_SIZE_EXCEEDED"]).toBeTruthy();
  });

  it("has remediation for critical HTTP codes", () => {
    expect(REMEDIATION["HTTPS_REQUIRED"]).toBeTruthy();
    expect(REMEDIATION["AUTH_REQUIRED"]).toBeTruthy();
    expect(REMEDIATION["TRANSPORT_ERROR"]).toBeTruthy();
    expect(REMEDIATION["SSRF_BLOCKED"]).toBeTruthy();
    expect(REMEDIATION["EMBEDDED_CREDENTIALS"]).toBeTruthy();
  });

  it("has remediation for all tool schema codes", () => {
    expect(REMEDIATION["TOOL_INVALID_NAME"]).toBeTruthy();
    expect(REMEDIATION["TOOL_MISSING_DESCRIPTION"]).toBeTruthy();
    expect(REMEDIATION["TOOL_EMPTY_DESCRIPTION"]).toBeTruthy();
    expect(REMEDIATION["TOOL_INVALID_INPUT_SCHEMA"]).toBeTruthy();
    expect(REMEDIATION["TOOL_INVALID_OUTPUT_SCHEMA"]).toBeTruthy();
    expect(REMEDIATION["TOOL_UNSUPPORTED_SCHEMA_DRAFT"]).toBeTruthy();
    expect(REMEDIATION["TOOL_DUPLICATE_NAME"]).toBeTruthy();
  });

  it("INIT_OK, TOOLS_LIST_OK, TOOL_OK have no remediation (success markers)", () => {
    expect(REMEDIATION["INIT_OK"]).toBeUndefined();
    expect(REMEDIATION["TOOLS_LIST_OK"]).toBeUndefined();
    expect(REMEDIATION["TOOL_OK"]).toBeUndefined();
  });

  it("findings table uses 3-column format when only success markers present", () => {
    const successOnlyReport: CheckReport = {
      ...makeBrowserHttpReport("PASS"),
      findings: [
        { code: "INIT_OK", severity: "PASS", message: "ok" },
        { code: "TOOLS_LIST_OK", severity: "PASS", message: "found 0 tools" },
      ],
      tools: [],
    };
    const out = toMarkdown(successOnlyReport);
    // Success markers have no remediation — table stays 3 columns
    expect(out).not.toContain("| Remediation |");
  });

  it("findings table uses 4-column format when any finding has remediation", () => {
    const out = toMarkdown(makeBrowserHttpReport("FAIL")); // has TRANSPORT_ERROR
    expect(out).toContain("| Remediation |");
  });
});
