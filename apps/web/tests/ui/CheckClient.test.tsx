// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CheckReport } from "@mcp-launch/core";
import CheckClient from "../../src/components/CheckClient.js";

// The Results component is rendered inside CheckClient; importing it allows
// us to verify its output without mounting the full tree separately.

const PASS_REPORT: CheckReport = {
  schemaVersion: "1",
  serverUrl: "https://example.com/mcp",
  checkedAt: "2026-01-01T00:00:00.000Z",
  durationMs: 42,
  overallStatus: "PASS",
  transport: {
    httpStatus: 200,
    httpStatusText: "OK",
    durationMs: 10,
    redirectCount: 0,
    headersAvailable: true,
  },
  protocolVersion: "1.0.0",
  serverInfo: { name: "test-server", version: "1.0.0" },
  findings: [
    { code: "INIT_OK", severity: "PASS", message: "MCP initialization succeeded" },
    { code: "TOOLS_LIST_OK", severity: "PASS", message: "Found 2 tool(s)" },
  ],
  tools: [
    {
      name: "get_weather",
      overallStatus: "PASS",
      findings: [{ code: "TOOL_OK", severity: "PASS", message: 'Tool "get_weather" passed all checks' }],
    },
  ],
};

const FAIL_REPORT: CheckReport = {
  ...PASS_REPORT,
  overallStatus: "FAIL",
  findings: [
    { code: "TRANSPORT_ERROR", severity: "FAIL", message: "Connection refused" },
  ],
  tools: [],
};

const WARN_REPORT: CheckReport = {
  ...PASS_REPORT,
  overallStatus: "WARNING",
  findings: [
    { code: "TOOL_EMPTY_DESCRIPTION", severity: "WARNING", message: "Tool has empty description" },
  ],
};

function mockFetchSuccess(report: CheckReport = PASS_REPORT) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ report }),
  });
}

function mockFetchApiError(error: string, message: string) {
  return vi.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ error, message }),
  });
}

describe("CheckClient", () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
    // jsdom does not implement scrollIntoView; stub it to avoid TypeError.
    Element.prototype.scrollIntoView = vi.fn();
    // jsdom does not implement matchMedia; stub it to return non-reduced-motion.
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ---- Form rendering ----

  it("renders the endpoint input with label", () => {
    render(<CheckClient />);
    expect(screen.getByLabelText(/MCP Endpoint/i)).toBeDefined();
  });

  it("renders the submit button", () => {
    render(<CheckClient />);
    expect(screen.getByRole("button", { name: /run release check/i })).toBeDefined();
  });

  // ---- Submission ----

  it("submits the endpoint via POST /api/check", async () => {
    const fetchSpy = mockFetchSuccess();
    vi.stubGlobal("fetch", fetchSpy);
    render(<CheckClient />);

    await user.type(screen.getByLabelText(/MCP Endpoint/i), "https://example.com/mcp");
    await user.click(screen.getByRole("button", { name: /run release check/i }));

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/check",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ "Content-Type": "application/json" }),
          body: JSON.stringify({ endpoint: "https://example.com/mcp" }),
        }),
      ),
    );
  });

  // ---- Loading state ----

  it("shows loading indicator while fetch is in progress", async () => {
    let resolvePromise!: (v: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(
        new Promise<Response>((r) => { resolvePromise = r; }),
      ),
    );
    render(<CheckClient />);

    await user.type(screen.getByLabelText(/MCP Endpoint/i), "https://example.com/mcp");
    await user.click(screen.getByRole("button", { name: /run release check/i }));

    expect(screen.getByText(/checking/i)).toBeDefined();
    expect(screen.getByRole("button", { name: /checking/i }).getAttribute("aria-busy")).toBe("true");

    // Clean up
    resolvePromise(new Response(JSON.stringify({ report: PASS_REPORT }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
  });

  it("disables the submit button while loading", async () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    render(<CheckClient />);

    await user.type(screen.getByLabelText(/MCP Endpoint/i), "https://example.com/mcp");
    await user.click(screen.getByRole("button", { name: /run release check/i }));

    const btn = screen.getByRole("button", { name: /checking/i });
    expect(btn.hasAttribute("disabled")).toBe(true);
  });

  // ---- Validation errors ----

  it("shows a validation error for empty endpoint", async () => {
    render(<CheckClient />);
    await user.click(screen.getByRole("button", { name: /run release check/i }));
    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByText(/required/i)).toBeDefined();
  });

  it("shows a validation error for HTTP endpoint", async () => {
    render(<CheckClient />);
    await user.type(screen.getByLabelText(/MCP Endpoint/i), "http://example.com/mcp");
    await user.click(screen.getByRole("button", { name: /run release check/i }));
    expect(screen.getByText(/https/i)).toBeDefined();
  });

  // ---- PASS rendering ----

  it("renders PASS status after successful check", async () => {
    vi.stubGlobal("fetch", mockFetchSuccess(PASS_REPORT));
    render(<CheckClient />);

    await user.type(screen.getByLabelText(/MCP Endpoint/i), "https://example.com/mcp");
    await user.click(screen.getByRole("button", { name: /run release check/i }));

    // "Overall Status" label is unique; PASS badges appear multiple times
    await waitFor(() => expect(screen.getByText("Overall Status")).toBeDefined());
    expect(screen.getAllByText("PASS").length).toBeGreaterThan(0);
  });

  // ---- FAIL rendering ----

  it("renders FAIL status for a failing report", async () => {
    vi.stubGlobal("fetch", mockFetchSuccess(FAIL_REPORT));
    render(<CheckClient />);

    await user.type(screen.getByLabelText(/MCP Endpoint/i), "https://example.com/mcp");
    await user.click(screen.getByRole("button", { name: /run release check/i }));

    await waitFor(() => expect(screen.getByText("Overall Status")).toBeDefined());
    expect(screen.getAllByText("FAIL").length).toBeGreaterThan(0);
  });

  // ---- WARNING rendering ----

  it("renders WARNING status for a report with warnings", async () => {
    vi.stubGlobal("fetch", mockFetchSuccess(WARN_REPORT));
    render(<CheckClient />);

    await user.type(screen.getByLabelText(/MCP Endpoint/i), "https://example.com/mcp");
    await user.click(screen.getByRole("button", { name: /run release check/i }));

    await waitFor(() => expect(screen.getByText("Overall Status")).toBeDefined());
    expect(screen.getAllByText("WARNING").length).toBeGreaterThan(0);
  });

  // ---- API error rendering ----

  it("renders API error message for rate limit response", async () => {
    vi.stubGlobal("fetch", mockFetchApiError("RATE_LIMIT_EXCEEDED", "Too many requests."));
    render(<CheckClient />);

    await user.type(screen.getByLabelText(/MCP Endpoint/i), "https://example.com/mcp");
    await user.click(screen.getByRole("button", { name: /run release check/i }));

    await waitFor(() => expect(screen.getByText("RATE_LIMIT_EXCEEDED")).toBeDefined());
    expect(screen.getByText(/too many requests/i)).toBeDefined();
  });

  it("renders API error for network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<CheckClient />);

    await user.type(screen.getByLabelText(/MCP Endpoint/i), "https://example.com/mcp");
    await user.click(screen.getByRole("button", { name: /run release check/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
    // "Try again" appears in both the error message body and the retry button;
    // use getByRole to target the button specifically.
    expect(screen.getByRole("button", { name: /try again/i })).toBeDefined();
  });

  // ---- Discovered tools rendering ----

  it("shows tool names in the results", async () => {
    vi.stubGlobal("fetch", mockFetchSuccess(PASS_REPORT));
    render(<CheckClient />);

    await user.type(screen.getByLabelText(/MCP Endpoint/i), "https://example.com/mcp");
    await user.click(screen.getByRole("button", { name: /run release check/i }));

    await waitFor(() => expect(screen.getByText("get_weather")).toBeDefined());
  });

  // ---- Export actions ----

  it("renders Download JSON button after check", async () => {
    vi.stubGlobal("fetch", mockFetchSuccess(PASS_REPORT));
    render(<CheckClient />);

    await user.type(screen.getByLabelText(/MCP Endpoint/i), "https://example.com/mcp");
    await user.click(screen.getByRole("button", { name: /run release check/i }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /download json/i })).toBeDefined(),
    );
  });

  it("renders Download Markdown button after check", async () => {
    vi.stubGlobal("fetch", mockFetchSuccess(PASS_REPORT));
    render(<CheckClient />);

    await user.type(screen.getByLabelText(/MCP Endpoint/i), "https://example.com/mcp");
    await user.click(screen.getByRole("button", { name: /run release check/i }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /download markdown/i })).toBeDefined(),
    );
  });

  it("renders Copy JSON button after check", async () => {
    vi.stubGlobal("fetch", mockFetchSuccess(PASS_REPORT));
    render(<CheckClient />);

    await user.type(screen.getByLabelText(/MCP Endpoint/i), "https://example.com/mcp");
    await user.click(screen.getByRole("button", { name: /run release check/i }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /copy json/i })).toBeDefined(),
    );
  });

  // ---- Retry / reset ----

  it("resets to idle state when 'Run another check' is clicked", async () => {
    vi.stubGlobal("fetch", mockFetchSuccess(PASS_REPORT));
    render(<CheckClient />);

    await user.type(screen.getByLabelText(/MCP Endpoint/i), "https://example.com/mcp");
    await user.click(screen.getByRole("button", { name: /run release check/i }));

    await waitFor(() => screen.getByRole("button", { name: /run another check/i }));
    await user.click(screen.getByRole("button", { name: /run another check/i }));

    // Results gone, form back
    expect(screen.queryByText("Overall Status")).toBeNull();
    expect(screen.getByRole("button", { name: /run release check/i })).toBeDefined();
  });

  it("resets to idle after error when 'Try again' is clicked", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed")));
    render(<CheckClient />);

    await user.type(screen.getByLabelText(/MCP Endpoint/i), "https://example.com/mcp");
    await user.click(screen.getByRole("button", { name: /run release check/i }));

    await waitFor(() => screen.getByRole("button", { name: /try again/i }));
    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(screen.getByRole("button", { name: /run release check/i })).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // ---- Accessibility ----

  it("marks the input as aria-invalid when validation fails", async () => {
    render(<CheckClient />);
    await user.click(screen.getByRole("button", { name: /run release check/i }));

    const input = screen.getByLabelText(/MCP Endpoint/i);
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("associates error message with input via aria-describedby", async () => {
    render(<CheckClient />);
    await user.click(screen.getByRole("button", { name: /run release check/i }));

    const input = screen.getByLabelText(/MCP Endpoint/i);
    const describedById = input.getAttribute("aria-describedby");
    expect(describedById).toBeTruthy();

    // The described element should contain the error text
    const errorEl = document.getElementById(describedById!);
    expect(errorEl).toBeTruthy();
    expect(errorEl?.textContent).toMatch(/required/i);
  });

  it("does not render raw stack traces in error states", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(
        new TypeError("Failed to fetch — at Object.<anonymous>:1:1"),
      ),
    );
    render(<CheckClient />);

    await user.type(screen.getByLabelText(/MCP Endpoint/i), "https://example.com/mcp");
    await user.click(screen.getByRole("button", { name: /run release check/i }));

    await waitFor(() => screen.getByRole("alert"));
    // The stack trace text of the thrown error must NOT be rendered
    expect(screen.queryByText(/at Object\.<anonymous>/)).toBeNull();
  });

  // ---- Secret redaction ----

  it("does not render secret endpoint credentials in results", async () => {
    // The report from a server with credentials in the URL should have them
    // redacted (core handles this). Verify the UI doesn't show the raw URL.
    const reportWithSafeUrl: CheckReport = {
      ...PASS_REPORT,
      serverUrl: "https://example.com/mcp?token=[REDACTED]",
    };
    vi.stubGlobal("fetch", mockFetchSuccess(reportWithSafeUrl));
    render(<CheckClient />);

    await user.type(
      screen.getByLabelText(/MCP Endpoint/i),
      "https://example.com/mcp?token=my-super-secret",
    );
    await user.click(screen.getByRole("button", { name: /run release check/i }));

    await waitFor(() => screen.getByText("Overall Status"));
    expect(screen.queryByText("my-super-secret")).toBeNull();
  });

  // ---- Aggregated summary metrics ----

  // Regression: summary counts previously only scanned report.findings (top-level).
  // Tool-level findings were excluded, causing FAIL/WARNING counts to show 0.

  // RTL's getNodeText uses only direct text-node children (not child element
  // text), so <summary>Failures<span>1</span></summary> also matches "Failures".
  // Use getAllByText and pick [0] (the metrics grid always appears first in DOM).

  it("shows Failures count of 0 for PASS report (no findings fail)", async () => {
    vi.stubGlobal("fetch", mockFetchSuccess(PASS_REPORT));
    render(<CheckClient />);
    await user.type(screen.getByLabelText(/MCP Endpoint/i), "https://example.com/mcp");
    await user.click(screen.getByRole("button", { name: /run release check/i }));

    await waitFor(() => screen.getByText("Overall Status"));
    // PASS report has no failures: only the metric label appears, no summary
    const label = screen.getByText("Failures");
    expect(label.previousElementSibling?.textContent).toBe("0");
  });

  it("shows Warnings count of 0 for PASS report", async () => {
    vi.stubGlobal("fetch", mockFetchSuccess(PASS_REPORT));
    render(<CheckClient />);
    await user.type(screen.getByLabelText(/MCP Endpoint/i), "https://example.com/mcp");
    await user.click(screen.getByRole("button", { name: /run release check/i }));

    await waitFor(() => screen.getByText("Overall Status"));
    // PASS report has no warnings: only the metric label appears, no summary
    const label = screen.getByText("Warnings");
    expect(label.previousElementSibling?.textContent).toBe("0");
  });

  it("counts tool-level FAIL finding in summary Failures metric", async () => {
    // The FAIL finding is only in tools[].findings, not in report.findings.
    // Previously this caused the Failures metric to show 0 incorrectly.
    const toolFailReport: CheckReport = {
      schemaVersion: "1",
      serverUrl: "https://example.com/mcp",
      checkedAt: "2026-01-01T00:00:00.000Z",
      durationMs: 100,
      overallStatus: "FAIL",
      transport: null,
      protocolVersion: null,
      serverInfo: null,
      findings: [
        { code: "INIT_OK", severity: "PASS", message: "Init ok" },
        { code: "TOOLS_LIST_OK", severity: "PASS", message: "Tools listed" },
      ],
      tools: [
        {
          name: "bad_tool",
          overallStatus: "FAIL",
          findings: [
            { code: "TOOL_INVALID_NAME", severity: "FAIL", message: "Invalid tool name" },
          ],
        },
      ],
    };
    vi.stubGlobal("fetch", mockFetchSuccess(toolFailReport));
    render(<CheckClient />);
    await user.type(screen.getByLabelText(/MCP Endpoint/i), "https://example.com/mcp");
    await user.click(screen.getByRole("button", { name: /run release check/i }));

    await waitFor(() => screen.getByText("Overall Status"));
    // getAllByText because a <summary>Failures<span>1</span></summary> in the
    // tool section also matches "Failures" via RTL's direct-text-node algorithm.
    // The metrics grid label is always first in DOM order.
    const [metricLabel] = screen.getAllByText("Failures");
    expect(metricLabel.previousElementSibling?.textContent).toBe("1");
  });

  it("counts tool-level WARNING finding in summary Warnings metric", async () => {
    const toolWarnReport: CheckReport = {
      schemaVersion: "1",
      serverUrl: "https://example.com/mcp",
      checkedAt: "2026-01-01T00:00:00.000Z",
      durationMs: 100,
      overallStatus: "WARNING",
      transport: null,
      protocolVersion: null,
      serverInfo: null,
      findings: [
        { code: "INIT_OK", severity: "PASS", message: "Init ok" },
        { code: "TOOLS_LIST_OK", severity: "PASS", message: "Tools listed" },
      ],
      tools: [
        {
          name: "warn_tool",
          overallStatus: "WARNING",
          findings: [
            { code: "TOOL_EMPTY_DESCRIPTION", severity: "WARNING", message: "Empty description" },
          ],
        },
      ],
    };
    vi.stubGlobal("fetch", mockFetchSuccess(toolWarnReport));
    render(<CheckClient />);
    await user.type(screen.getByLabelText(/MCP Endpoint/i), "https://example.com/mcp");
    await user.click(screen.getByRole("button", { name: /run release check/i }));

    await waitFor(() => screen.getByText("Overall Status"));
    const [metricLabel] = screen.getAllByText("Warnings");
    expect(metricLabel.previousElementSibling?.textContent).toBe("1");
  });

  it("aggregates mixed top-level and tool-level findings in summary", async () => {
    const mixedReport: CheckReport = {
      schemaVersion: "1",
      serverUrl: "https://example.com/mcp",
      checkedAt: "2026-01-01T00:00:00.000Z",
      durationMs: 100,
      overallStatus: "FAIL",
      transport: null,
      protocolVersion: null,
      serverInfo: null,
      findings: [
        { code: "INIT_FAILURE", severity: "FAIL", message: "Top-level failure" },
      ],
      tools: [
        {
          name: "tool_a",
          overallStatus: "FAIL",
          findings: [
            { code: "TOOL_INVALID_NAME", severity: "FAIL", message: "Tool failure" },
          ],
        },
      ],
    };
    vi.stubGlobal("fetch", mockFetchSuccess(mixedReport));
    render(<CheckClient />);
    await user.type(screen.getByLabelText(/MCP Endpoint/i), "https://example.com/mcp");
    await user.click(screen.getByRole("button", { name: /run release check/i }));

    await waitFor(() => screen.getByText("Overall Status"));
    // 2 failures: one top-level + one tool-level. Metric grid is first in DOM.
    const [metricLabel] = screen.getAllByText("Failures");
    expect(metricLabel.previousElementSibling?.textContent).toBe("2");
  });

  // ---- Export consistency ----

  it("JSON export button is present and tool findings are rendered", async () => {
    const toolFailReport: CheckReport = {
      ...PASS_REPORT,
      overallStatus: "FAIL",
      findings: [{ code: "INIT_OK", severity: "PASS", message: "ok" }],
      tools: [
        {
          name: "unique_export_tool",
          overallStatus: "FAIL",
          findings: [
            { code: "TOOL_INVALID_NAME", severity: "FAIL", message: "Invalid tool name" },
          ],
        },
      ],
    };
    vi.stubGlobal("fetch", mockFetchSuccess(toolFailReport));
    render(<CheckClient />);
    await user.type(screen.getByLabelText(/MCP Endpoint/i), "https://example.com/mcp");
    await user.click(screen.getByRole("button", { name: /run release check/i }));

    await waitFor(() => screen.getByText("Overall Status"));
    expect(screen.getByRole("button", { name: /download json/i })).toBeDefined();
    // Tool name rendered in the tools section confirms tool findings are present
    expect(screen.getByText("unique_export_tool")).toBeDefined();
  });

  it("Markdown export button is present when tool findings exist", async () => {
    vi.stubGlobal("fetch", mockFetchSuccess(FAIL_REPORT));
    render(<CheckClient />);
    await user.type(screen.getByLabelText(/MCP Endpoint/i), "https://example.com/mcp");
    await user.click(screen.getByRole("button", { name: /run release check/i }));

    await waitFor(() => screen.getByText("Overall Status"));
    expect(screen.getByRole("button", { name: /download markdown/i })).toBeDefined();
  });
});

// Suppress JSDOM's "Not implemented: navigation" warning from URL.createObjectURL
const originalError = console.error.bind(console);
beforeEach(() => {
  console.error = (...args: unknown[]) => {
    const msg = String(args[0] ?? "");
    if (msg.includes("Not implemented") || msg.includes("createObjectURL")) return;
    originalError(...args);
  };
});
afterEach(() => {
  console.error = originalError;
});
