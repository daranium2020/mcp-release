// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import HomePage from "../../src/app/page.js";

// Mock CheckClient. Its own behavior is tested in CheckClient.test.tsx.
// We capture the demoEndpoint prop to verify the page passes it correctly.
let capturedDemoEndpoint: string | undefined;
vi.mock("../../src/components/CheckClient.js", () => ({
  default: ({ demoEndpoint }: { demoEndpoint?: string }) => {
    capturedDemoEndpoint = demoEndpoint;
    return (
      <div data-testid="check-client">
        {demoEndpoint && (
          <span data-testid="demo-endpoint-prop">{demoEndpoint}</span>
        )}
      </div>
    );
  },
}));

describe("HomePage", () => {
  afterEach(() => {
    capturedDemoEndpoint = undefined;
    vi.clearAllMocks();
  });

  // ---- Headline and copy ----

  it("renders the primary headline", () => {
    render(<HomePage />);
    expect(
      screen.getByRole("heading", { level: 1 }).textContent,
    ).toContain("Check an MCP server before release");
  });

  it("renders supporting subhead copy", () => {
    render(<HomePage />);
    expect(
      screen.getByText(/verify the protocol handshake, tool schemas/i),
    ).toBeDefined();
  });

  // ---- Navigation ----

  it("renders a View documentation link to /docs", () => {
    render(<HomePage />);
    const link = screen.getByRole("link", { name: /view documentation/i });
    expect(link.getAttribute("href")).toBe("/docs");
  });

  it("renders a Docs link in the header navigation", () => {
    render(<HomePage />);
    const docsLinks = screen.getAllByRole("link", { name: /^docs$/i });
    expect(docsLinks.length).toBeGreaterThanOrEqual(1);
  });

  // ---- Demo endpoint ----

  it("passes the public fixture URL as demoEndpoint to CheckClient", () => {
    render(<HomePage />);
    expect(capturedDemoEndpoint).toBe(
      "https://mcp-release-fixture.vercel.app/mcp",
    );
  });

  it("renders the demo endpoint URL in the demo section", () => {
    render(<HomePage />);
    // URL appears in the demo section; getAllByText handles multiple occurrences
    const els = screen.getAllByText(
      "https://mcp-release-fixture.vercel.app/mcp",
    );
    expect(els.length).toBeGreaterThanOrEqual(1);
  });

  // ---- Trust / safety ----

  it("explains that tools are never invoked (security model section)", () => {
    const { container } = render(<HomePage />);
    const text = container.textContent?.toLowerCase() ?? "";
    expect(text).toContain("never invoked");
  });

  it("explains that no credentials are accepted or stored (security model section)", () => {
    const { container } = render(<HomePage />);
    const text = container.textContent?.toLowerCase() ?? "";
    expect(text).toContain("no endpoint credentials");
  });

  // ---- Result meanings ----

  it("explains PASS result meaning", () => {
    render(<HomePage />);
    expect(
      screen.getByText(/all checks passed/i),
    ).toBeDefined();
  });

  it("explains WARNING result meaning", () => {
    render(<HomePage />);
    expect(
      screen.getByText(/some checks did not complete/i),
    ).toBeDefined();
  });

  it("explains FAIL result meaning", () => {
    render(<HomePage />);
    expect(
      screen.getByText(/one or more blocking findings/i),
    ).toBeDefined();
  });

  it("mentions AUTH_REQUIRED for authenticated endpoints", () => {
    const { container } = render(<HomePage />);
    const text = container.textContent ?? "";
    expect(text).toContain("AUTH_REQUIRED");
  });

  it("clarifies that a PASS is not a universal guarantee", () => {
    const { container } = render(<HomePage />);
    const text = container.textContent?.toLowerCase() ?? "";
    expect(text).toContain("not a guarantee");
  });

  // ---- No unsupported claims ----

  it("does not claim the server is certified", () => {
    const { container } = render(<HomePage />);
    expect(container.textContent?.toLowerCase()).not.toContain("certified");
  });

  it("does not claim the server is audited", () => {
    const { container } = render(<HomePage />);
    expect(container.textContent?.toLowerCase()).not.toContain("audited");
  });

  it("does not claim guaranteed security", () => {
    const { container } = render(<HomePage />);
    expect(container.textContent?.toLowerCase()).not.toContain(
      "guaranteed secure",
    );
  });

  // ---- No auto-execution on load ----

  it("does not call fetch on mount", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<HomePage />);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  // ---- GitHub link ----

  it("does not render a GitHub link in the header", () => {
    render(<HomePage />);
    const ghLinks = screen
      .getAllByRole("link")
      .filter((l) => l.getAttribute("href")?.includes("github.com"));
    expect(ghLinks.length).toBe(0);
  });

  it("renders the Feedback link in the header", () => {
    render(<HomePage />);
    const feedbackLinks = screen
      .getAllByRole("link")
      .filter((l) => l.getAttribute("href") === "mailto:feedback@mcprelease.dev");
    expect(feedbackLinks.length).toBeGreaterThanOrEqual(1);
  });
});
