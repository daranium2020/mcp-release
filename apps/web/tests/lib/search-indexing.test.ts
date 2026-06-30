import { describe, it, expect } from "vitest";
import robots from "../../src/app/robots.js";
import sitemap from "../../src/app/sitemap.js";

// ---------------------------------------------------------------------------
// Helpers — normalise the MetadataRoute.Robots rules union to an array so
// tests are robust whether the implementation uses a single rule object or
// an array of rule objects.
// ---------------------------------------------------------------------------

type RulesArray = Array<{
  userAgent?: string | string[] | undefined;
  allow?: string | string[] | undefined;
  disallow?: string | string[] | undefined;
}>;

function normaliseRules(
  rules: ReturnType<typeof robots>["rules"],
): RulesArray {
  return Array.isArray(rules) ? rules : [rules];
}

function allDisallowed(rules: RulesArray): string[] {
  return rules.flatMap((r) =>
    Array.isArray(r.disallow) ? r.disallow : r.disallow ? [r.disallow] : [],
  );
}

function allAllowed(rules: RulesArray): string[] {
  return rules.flatMap((r) =>
    Array.isArray(r.allow) ? r.allow : r.allow ? [r.allow] : [],
  );
}

// ---------------------------------------------------------------------------
// robots()
// ---------------------------------------------------------------------------

describe("robots() — crawl rules", () => {
  const result = robots();
  const rules = normaliseRules(result.rules);

  it("has at least one rule", () => {
    expect(rules.length).toBeGreaterThan(0);
  });

  it("wildcard user-agent rule exists", () => {
    const wildcardRule = rules.find((r) => {
      const ua = Array.isArray(r.userAgent) ? r.userAgent : [r.userAgent ?? ""];
      return ua.includes("*");
    });
    expect(wildcardRule).toBeDefined();
  });

  it("/ is explicitly allowed", () => {
    expect(allAllowed(rules)).toContain("/");
  });

  it("/api/ is disallowed", () => {
    expect(allDisallowed(rules)).toContain("/api/");
  });

  it("homepage / is not disallowed", () => {
    expect(allDisallowed(rules)).not.toContain("/");
  });

  it("/docs is not disallowed", () => {
    expect(allDisallowed(rules)).not.toContain("/docs");
  });
});

describe("robots() — sitemap and host", () => {
  const result = robots();

  it("sitemap URL is https://mcprelease.dev/sitemap.xml", () => {
    const sitemaps = Array.isArray(result.sitemap)
      ? result.sitemap
      : [result.sitemap];
    expect(sitemaps).toContain("https://mcprelease.dev/sitemap.xml");
  });

  it("sitemap URL uses HTTPS", () => {
    const sitemaps = Array.isArray(result.sitemap)
      ? result.sitemap
      : [result.sitemap ?? ""];
    expect(sitemaps.every((s) => s.startsWith("https://"))).toBe(true);
  });

  it("host is the production domain", () => {
    expect(result.host).toBe("https://mcprelease.dev");
  });

  it("no localhost URLs anywhere in the robots configuration", () => {
    expect(JSON.stringify(result)).not.toContain("localhost");
  });
});

// ---------------------------------------------------------------------------
// sitemap()
// ---------------------------------------------------------------------------

describe("sitemap() — entries", () => {
  const result = sitemap();

  it("contains exactly 2 entries", () => {
    expect(result).toHaveLength(2);
  });

  it("includes the homepage (https://mcprelease.dev/)", () => {
    expect(result.some((e) => e.url === "https://mcprelease.dev/")).toBe(true);
  });

  it("includes /docs (https://mcprelease.dev/docs)", () => {
    expect(result.some((e) => e.url === "https://mcprelease.dev/docs")).toBe(
      true,
    );
  });
});

describe("sitemap() — URL correctness", () => {
  const result = sitemap();

  it("all URLs use HTTPS", () => {
    expect(result.every((e) => e.url.startsWith("https://"))).toBe(true);
  });

  it("all URLs are on mcprelease.dev", () => {
    expect(
      result.every((e) => e.url.startsWith("https://mcprelease.dev")),
    ).toBe(true);
  });

  it("no localhost URLs", () => {
    expect(result.every((e) => !e.url.includes("localhost"))).toBe(true);
  });

  it("no preview or fixture URLs", () => {
    expect(
      result.every(
        (e) => !e.url.includes("preview") && !e.url.includes("fixture"),
      ),
    ).toBe(true);
  });

  it("no API routes", () => {
    expect(result.every((e) => !e.url.includes("/api/"))).toBe(true);
  });

  it("no image metadata routes (opengraph-image, twitter-image)", () => {
    expect(
      result.every(
        (e) =>
          !e.url.includes("opengraph-image") &&
          !e.url.includes("twitter-image"),
      ),
    ).toBe(true);
  });
});
