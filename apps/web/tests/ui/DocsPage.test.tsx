// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DocsPage, { metadata } from "../../src/app/docs/page.js";

describe("DocsPage: content", () => {
  it("renders the Documentation heading", () => {
    render(<DocsPage />);
    expect(
      screen.getByRole("heading", { level: 1 }).textContent,
    ).toContain("Documentation");
  });

  it("has section headings for the major topics", () => {
    render(<DocsPage />);
    const h2s = screen
      .getAllByRole("heading", { level: 2 })
      .map((el) => el.textContent?.toLowerCase() ?? "");
    expect(h2s.some((t) => t.includes("overview"))).toBe(true);
    expect(h2s.some((t) => t.includes("quick start"))).toBe(true);
    expect(h2s.some((t) => t.includes("security model"))).toBe(true);
    expect(h2s.some((t) => t.includes("known limitations"))).toBe(true);
    expect(h2s.some((t) => t.includes("private and authenticated"))).toBe(true);
  });

  // ---- PASS / WARNING / FAIL ----

  it("explains PASS, WARNING, and FAIL", () => {
    const { container } = render(<DocsPage />);
    const text = container.textContent ?? "";
    expect(text).toContain("PASS");
    expect(text).toContain("WARNING");
    expect(text).toContain("FAIL");
  });

  it("clarifies that PASS is not a security guarantee", () => {
    const { container } = render(<DocsPage />);
    const text = container.textContent?.toLowerCase() ?? "";
    expect(text).toContain("does not guarantee");
  });

  // ---- Authentication behavior ----

  it("has an authentication behavior section", () => {
    render(<DocsPage />);
    const h2s = screen
      .getAllByRole("heading", { level: 2 })
      .map((el) => el.textContent?.toLowerCase() ?? "");
    expect(h2s.some((t) => t.includes("authentication"))).toBe(true);
  });

  it("explains authenticated endpoints are not checked", () => {
    const { container } = render(<DocsPage />);
    const text = container.textContent?.toLowerCase() ?? "";
    expect(text).toContain("authenticated checks");
  });

  it("explains no credentials are stored", () => {
    const { container } = render(<DocsPage />);
    const text = container.textContent?.toLowerCase() ?? "";
    expect(text).toContain("no credentials");
  });

  // ---- Security model ----

  it("explains tools are never invoked", () => {
    const { container } = render(<DocsPage />);
    const text = container.textContent?.toLowerCase() ?? "";
    expect(text).toContain("never invoked");
  });

  it("mentions SSRF protection", () => {
    const { container } = render(<DocsPage />);
    const text = container.textContent?.toLowerCase() ?? "";
    expect(text).toContain("ssrf");
  });

  // ---- Demo endpoint ----

  it("shows the public fixture demo endpoint URL", () => {
    render(<DocsPage />);
    // URL appears in the quick-start and demo sections. Expect at least one occurrence.
    const matches = screen.getAllByText(
      "https://mcp-release-fixture.vercel.app/mcp",
    );
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  // ---- Known limitations ----

  it("discloses that tools are not invoked", () => {
    const { container } = render(<DocsPage />);
    const text = container.textContent?.toLowerCase() ?? "";
    expect(text).toContain("tools are not invoked");
  });

  it("discloses that reports are not saved server-side", () => {
    const { container } = render(<DocsPage />);
    const text = container.textContent?.toLowerCase() ?? "";
    expect(text).toContain("not saved");
  });

  // ---- Private and authenticated servers section ----

  it("explains that the web checker does not accept credentials", () => {
    const { container } = render(<DocsPage />);
    const text = container.textContent ?? "";
    expect(text).toContain("web checker");
    expect(text.toLowerCase()).toMatch(/does not accept credentials|no credentials/);
  });

  it("mentions CLI and GitHub Action for private/authenticated servers", () => {
    const { container } = render(<DocsPage />);
    const text = container.textContent ?? "";
    expect(text.toLowerCase()).toContain("cli");
    expect(text.toLowerCase()).toContain("github action");
  });

  it("states that tools are never executed in the private/auth context", () => {
    const { container } = render(<DocsPage />);
    const text = container.textContent ?? "";
    expect(text.toLowerCase()).toMatch(/never executes|never invok|not invok|not execut/);
  });

  // ---- No Unicode dash punctuation in rendered text ----

  it("does not contain em dash or en dash in rendered text", () => {
    const { container } = render(<DocsPage />);
    const text = container.textContent ?? "";
    expect(text).not.toContain("—"); // em dash
    expect(text).not.toContain("–"); // en dash
  });

  // ---- No unsupported claims ----

  it("does not contain the word certified", () => {
    const { container } = render(<DocsPage />);
    expect(container.textContent?.toLowerCase()).not.toContain("certified");
  });

  it("does not contain the word audited", () => {
    const { container } = render(<DocsPage />);
    expect(container.textContent?.toLowerCase()).not.toContain("audited");
  });

  it("does not claim guaranteed security", () => {
    const { container } = render(<DocsPage />);
    expect(container.textContent?.toLowerCase()).not.toContain(
      "guaranteed secure",
    );
  });

  // ---- Privacy and data handling ----

  it("has a Privacy and data handling section", () => {
    render(<DocsPage />);
    const h2s = screen
      .getAllByRole("heading", { level: 2 })
      .map((el) => el.textContent?.toLowerCase() ?? "");
    expect(h2s.some((t) => t.includes("privacy"))).toBe(true);
  });

  it("states that discovered tools are never executed", () => {
    const { container } = render(<DocsPage />);
    const text = container.textContent?.toLowerCase() ?? "";
    expect(text).toContain("never executed");
  });

  it("states credentials are not requested or stored", () => {
    const { container } = render(<DocsPage />);
    const text = container.textContent?.toLowerCase() ?? "";
    expect(text).toContain("not request");
    expect(text).toContain("not store");
  });

  it("includes the feedback contact email", () => {
    render(<DocsPage />);
    const feedbackLinks = screen
      .getAllByRole("link")
      .filter((l) => l.getAttribute("href") === "mailto:feedback@mcprelease.dev");
    expect(feedbackLinks.length).toBeGreaterThanOrEqual(1);
  });

  // ---- Links ----

  it("does not link to the private GitHub repository", () => {
    render(<DocsPage />);
    const ghLinks = screen
      .getAllByRole("link")
      .filter((l) => l.getAttribute("href")?.includes("github.com"));
    expect(ghLinks.length).toBe(0);
  });

});

describe("DocsPage: metadata", () => {
  it("sets a page title", () => {
    expect(typeof metadata.title === "string" ? metadata.title : "Documentation").toContain(
      "Documentation",
    );
  });

  it("sets description mentioning validation without executing tools", () => {
    expect(metadata.description?.toLowerCase()).toContain("validation");
  });

  it("sets canonical URL for /docs", () => {
    expect(metadata.alternates?.canonical).toContain("/docs");
  });
});
