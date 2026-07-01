// Tests for the response-validation logic in scripts/production-smoke.mjs.
// No production network calls are made; all checks use synthetic data.
import { describe, it, expect } from "vitest";
import {
  validateHomepageContent,
  validateDocsContent,
  validateRobotsContent,
  validateSitemapContent,
  validateApiCheckResponse,
  isImageContentType,
  isWithinOrigin,
  withRetry,
} from "../../../../scripts/production-smoke.mjs";

// ── Helpers ──────────────────────────────────────────────────────────────────

const PROD_ORIGIN = "https://mcprelease.dev";

function passReport(overrides = {}) {
  return {
    report: {
      schemaVersion: "1",
      serverUrl: "https://mcp-release-fixture.vercel.app/mcp",
      checkedAt: "2026-01-01T00:00:00.000Z",
      durationMs: 500,
      overallStatus: "PASS",
      transport: { httpStatus: 200, httpStatusText: "OK", durationMs: 100, redirectCount: 0, headersAvailable: true },
      protocolVersion: "2025-03-26",
      serverInfo: { name: "public-mcp-fixture", version: "1.0.0" },
      findings: [
        { code: "INIT_OK", severity: "PASS", message: "MCP initialization succeeded" },
        { code: "TOOLS_LIST_OK", severity: "PASS", message: "Found 2 tool(s)" },
      ],
      tools: [
        { name: "echo", findings: [{ code: "TOOL_OK", severity: "PASS", message: "OK" }], overallStatus: "PASS" },
        { name: "ping", findings: [{ code: "TOOL_OK", severity: "PASS", message: "OK" }], overallStatus: "PASS" },
      ],
      ...overrides,
    },
  };
}

// ── validateApiCheckResponse ──────────────────────────────────────────────────

describe("validateApiCheckResponse", () => {
  it("accepts a well-formed PASS response", () => {
    const result = validateApiCheckResponse(passReport());
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects when overallStatus is FAIL", () => {
    const body = passReport();
    body.report.overallStatus = "FAIL";
    const result = validateApiCheckResponse(body);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("FAIL"))).toBe(true);
  });

  it("rejects when overallStatus is WARNING", () => {
    const body = passReport();
    body.report.overallStatus = "WARNING";
    const result = validateApiCheckResponse(body);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("WARNING"))).toBe(true);
  });

  it("rejects when a finding has FAIL severity", () => {
    const body = passReport();
    body.report.findings.push({ code: "TRANSPORT_ERROR", severity: "FAIL", message: "refused" });
    const result = validateApiCheckResponse(body);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("FAIL finding"))).toBe(true);
  });

  it("rejects when a finding has WARNING severity", () => {
    const body = passReport();
    body.report.findings.push({ code: "AUTH_REQUIRED", severity: "WARNING", message: "auth" });
    const result = validateApiCheckResponse(body);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("WARNING finding"))).toBe(true);
  });

  it("rejects when expected tool is missing", () => {
    const body = passReport();
    body.report.tools = body.report.tools.filter((t: { name: string }) => t.name !== "ping");
    const result = validateApiCheckResponse(body);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('"ping"'))).toBe(true);
  });

  it("rejects when serverInfo.name is wrong", () => {
    const body = passReport();
    body.report.serverInfo = { name: "wrong-server", version: "1.0.0" };
    const result = validateApiCheckResponse(body);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("serverInfo.name"))).toBe(true);
  });

  it("rejects a non-object body", () => {
    const result = validateApiCheckResponse("not an object");
    expect(result.ok).toBe(false);
  });

  it("rejects a body with missing report field", () => {
    const result = validateApiCheckResponse({ something: "else" });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("report"))).toBe(true);
  });

  it("rejects when a tool finding indicates execution", () => {
    const body = passReport();
    body.report.tools[0].findings.push({
      code: "TOOL_EXECUTED",
      severity: "PASS",
      message: "tool was called",
    });
    const result = validateApiCheckResponse(body);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("TOOL_EXECUTED"))).toBe(true);
  });
});

// ── validateHomepageContent ───────────────────────────────────────────────────

describe("validateHomepageContent", () => {
  it("accepts HTML containing MCP Release", () => {
    expect(validateHomepageContent("<title>MCP Release</title>").ok).toBe(true);
  });

  it("rejects HTML without MCP Release", () => {
    const result = validateHomepageContent("<html><body>Hello</body></html>");
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

// ── validateDocsContent ───────────────────────────────────────────────────────

describe("validateDocsContent", () => {
  it("accepts HTML containing Privacy and data handling section", () => {
    const html = "<h2>Privacy and data handling</h2><p>No data stored.</p>";
    expect(validateDocsContent(html).ok).toBe(true);
  });

  it("rejects HTML without the privacy section", () => {
    const result = validateDocsContent("<h1>Documentation</h1><p>Overview</p>");
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("does not include the full response body in its error description", () => {
    const largeHtml = "MCP Release docs " + "x".repeat(50_000);
    const result = validateDocsContent(largeHtml);
    expect(result.ok).toBe(false);
    for (const err of result.errors) {
      expect(err.length).toBeLessThan(200);
    }
  });
});

// ── validateRobotsContent ─────────────────────────────────────────────────────

describe("validateRobotsContent", () => {
  const goodRobots = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Sitemap: https://mcprelease.dev/sitemap.xml",
  ].join("\n");

  it("accepts a correct robots.txt", () => {
    expect(validateRobotsContent(goodRobots).ok).toBe(true);
  });

  it("rejects when Disallow: /api/ is missing", () => {
    const text = goodRobots.replace("Disallow: /api/", "");
    const result = validateRobotsContent(text);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("/api/"))).toBe(true);
  });

  it("rejects when Sitemap directive is missing", () => {
    const text = goodRobots.replace("Sitemap: https://mcprelease.dev/sitemap.xml", "");
    const result = validateRobotsContent(text);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("sitemap.xml"))).toBe(true);
  });
});

// ── validateSitemapContent ────────────────────────────────────────────────────

describe("validateSitemapContent", () => {
  const goodSitemap = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    "  <url><loc>https://mcprelease.dev/</loc></url>",
    "  <url><loc>https://mcprelease.dev/docs</loc></url>",
    "</urlset>",
  ].join("\n");

  it("accepts a correct sitemap", () => {
    expect(validateSitemapContent(goodSitemap).ok).toBe(true);
  });

  it("rejects when a required URL is missing", () => {
    const text = goodSitemap.replace(
      "<url><loc>https://mcprelease.dev/docs</loc></url>",
      "",
    );
    const result = validateSitemapContent(text);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("/docs"))).toBe(true);
  });

  it("rejects when an unexpected external URL appears", () => {
    const text = goodSitemap.replace(
      "</urlset>",
      "  <url><loc>https://attacker.example.com/</loc></url>\n</urlset>",
    );
    const result = validateSitemapContent(text);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("attacker.example.com"))).toBe(true);
  });
});

// ── isImageContentType ────────────────────────────────────────────────────────

describe("isImageContentType", () => {
  it("accepts image/png", () => expect(isImageContentType("image/png")).toBe(true));
  it("accepts image/jpeg", () => expect(isImageContentType("image/jpeg")).toBe(true));
  it("accepts image/webp", () => expect(isImageContentType("image/webp")).toBe(true));
  it("rejects text/html", () => expect(isImageContentType("text/html")).toBe(false));
  it("rejects empty string", () => expect(isImageContentType("")).toBe(false));
  it("rejects undefined", () => expect(isImageContentType(undefined as unknown as string)).toBe(false));
});

// ── isWithinOrigin ────────────────────────────────────────────────────────────

describe("isWithinOrigin", () => {
  it("returns true for same-origin URL", () => {
    expect(isWithinOrigin(`${PROD_ORIGIN}/other-page`, PROD_ORIGIN)).toBe(true);
  });

  it("returns false for a different origin", () => {
    expect(isWithinOrigin("https://attacker.example.com/", PROD_ORIGIN)).toBe(false);
  });

  it("returns false for an http variant of the same host", () => {
    expect(isWithinOrigin("http://mcprelease.dev/", PROD_ORIGIN)).toBe(false);
  });

  it("returns false when responseUrl is malformed", () => {
    expect(isWithinOrigin("not-a-url", PROD_ORIGIN)).toBe(false);
  });
});

// ── withRetry ─────────────────────────────────────────────────────────────────

describe("withRetry", () => {
  it("returns the value on first success", async () => {
    const result = await withRetry(() => Promise.resolve(42), 2, 0);
    expect(result).toBe(42);
  });

  it("retries and succeeds on a later attempt", async () => {
    let calls = 0;
    const result = await withRetry(
      () => {
        calls++;
        if (calls < 3) throw new Error("transient");
        return Promise.resolve("ok");
      },
      2,
      0,
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("throws the last error after exhausting retries", async () => {
    let calls = 0;
    await expect(
      withRetry(
        () => {
          calls++;
          throw new Error(`attempt ${calls}`);
        },
        2,
        0,
      ),
    ).rejects.toThrow("attempt 3");
    expect(calls).toBe(3); // 1 initial + 2 retries
  });

  it("does not retry when the function resolves (even with an ok:false value)", async () => {
    let calls = 0;
    const result = await withRetry(
      () => {
        calls++;
        return Promise.resolve({ ok: false, errors: ["content mismatch"] });
      },
      2,
      0,
    );
    expect(result.ok).toBe(false);
    expect(calls).toBe(1);
  });
});
