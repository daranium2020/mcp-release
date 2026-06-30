// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import Header from "../../src/components/Header.js";

vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    className,
  }: {
    src: string | { src: string };
    alt: string;
    className?: string;
  }) => {
    const resolvedSrc =
      typeof src === "object" && src !== null ? (src as { src: string }).src : (src as string);
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={resolvedSrc} alt={alt} className={className} />;
  },
}));

describe("Header", () => {
  // ---- Logo image ----

  it("renders the MCP Release logo image", () => {
    render(<Header />);
    const logo = screen.getByRole("img", { name: "MCP Release" });
    expect(logo).toBeDefined();
  });

  it("logo src points to the brand asset", () => {
    render(<Header />);
    const logo = screen.getByRole("img", { name: "MCP Release" });
    expect(logo.getAttribute("src")).toContain("mcp-release-logo-light-text.png");
  });

  it("logo alt text is 'MCP Release'", () => {
    render(<Header />);
    const logo = screen.getByRole("img", { name: "MCP Release" });
    expect(logo.getAttribute("alt")).toBe("MCP Release");
  });

  // ---- Homepage link ----

  it("logo links to the homepage", () => {
    render(<Header />);
    const link = screen.getByRole("link", { name: "MCP Release" });
    expect(link.getAttribute("href")).toBe("/");
  });

  // ---- No duplicate text wordmark or descriptor ----

  it("does not render 'MCP Release' as a plain text node", () => {
    render(<Header />);
    // The logo image provides the visual wordmark; no separate text element should exist.
    expect(screen.queryByText("MCP Release")).toBeNull();
  });

  it("does not render the descriptor text in the header", () => {
    render(<Header />);
    expect(screen.queryByText("MCP server validation")).toBeNull();
  });

  // ---- Navigation ----

  it("renders the Docs navigation link", () => {
    render(<Header />);
    const docsLink = screen.getByRole("link", { name: /^docs$/i });
    expect(docsLink.getAttribute("href")).toBe("/docs");
  });

  it("renders the GitHub navigation link", () => {
    render(<Header />);
    const ghLinks = screen
      .getAllByRole("link")
      .filter((l) => l.getAttribute("href")?.includes("github.com"));
    expect(ghLinks.length).toBeGreaterThanOrEqual(1);
  });
});
