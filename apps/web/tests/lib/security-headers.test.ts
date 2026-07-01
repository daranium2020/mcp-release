import { describe, it, expect, beforeAll } from "vitest";
import config from "../../next.config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type HeaderEntry = { key: string; value: string };

let headerMap: Map<string, string>;

beforeAll(async () => {
  const rules = await config.headers!();
  const catchAll = rules.find((r) => r.source === "/(.*)");
  if (!catchAll) throw new Error("No catch-all header rule found in next.config");
  headerMap = new Map(
    catchAll.headers.map((h: HeaderEntry) => [h.key.toLowerCase(), h.value]),
  );
});

// Parse a CSP header value into a Map of directive → values array.
// Directive names are lowercased; values retain case.
function parseCSP(csp: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of csp.split(";")) {
    const tokens = part.trim().split(/\s+/);
    if (tokens.length === 0 || !tokens[0]) continue;
    const name = tokens[0].toLowerCase();
    directives.set(name, tokens.slice(1));
  }
  return directives;
}

// ---------------------------------------------------------------------------
// Content-Security-Policy
// ---------------------------------------------------------------------------

describe("Content-Security-Policy", () => {
  let csp: Map<string, string[]>;

  beforeAll(() => {
    const raw = headerMap.get("content-security-policy");
    if (!raw) throw new Error("Content-Security-Policy header is missing");
    csp = parseCSP(raw);
  });

  it("header is present", () => {
    expect(headerMap.has("content-security-policy")).toBe(true);
  });

  it("default-src is 'self'", () => {
    expect(csp.get("default-src")).toContain("'self'");
  });

  it("object-src is 'none'", () => {
    expect(csp.get("object-src")).toEqual(["'none'"]);
  });

  it("base-uri is 'self'", () => {
    expect(csp.get("base-uri")).toContain("'self'");
  });

  it("frame-ancestors is 'none'", () => {
    expect(csp.get("frame-ancestors")).toEqual(["'none'"]);
  });

  it("form-action is 'self'", () => {
    expect(csp.get("form-action")).toContain("'self'");
  });

  it("font-src is 'self' only", () => {
    const vals = csp.get("font-src") ?? [];
    expect(vals).toContain("'self'");
    expect(vals.filter((v) => v !== "'self'")).toHaveLength(0);
  });

  it("connect-src does not allow arbitrary external origins", () => {
    const vals = csp.get("connect-src") ?? [];
    expect(vals).toContain("'self'");
    // No wildcards or external origins
    expect(vals.some((v) => v === "*" || v.startsWith("http"))).toBe(false);
  });

  it("img-src includes 'self'", () => {
    expect(csp.get("img-src")).toContain("'self'");
  });

  it("no unsafe-eval in production CSP", () => {
    // The production CSP must not include 'unsafe-eval' in script-src.
    // Development mode adds it via process.env.NODE_ENV; this test runs
    // in the vitest node environment where NODE_ENV is 'test', not
    // 'development', so the production path is taken.
    const scriptSrc = csp.get("script-src") ?? [];
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it("script-src includes 'self'", () => {
    expect(csp.get("script-src")).toContain("'self'");
  });

  it("style-src includes 'self'", () => {
    expect(csp.get("style-src")).toContain("'self'");
  });
});

// ---------------------------------------------------------------------------
// Other security headers
// ---------------------------------------------------------------------------

describe("X-Content-Type-Options", () => {
  it("is nosniff", () => {
    expect(headerMap.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("Referrer-Policy", () => {
  it("is strict-origin-when-cross-origin", () => {
    expect(headerMap.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );
  });
});

describe("X-Frame-Options", () => {
  it("is DENY", () => {
    expect(headerMap.get("x-frame-options")).toBe("DENY");
  });
});

describe("Permissions-Policy", () => {
  let policy: string;

  beforeAll(() => {
    policy = headerMap.get("permissions-policy") ?? "";
  });

  it("header is present", () => {
    expect(policy.length).toBeGreaterThan(0);
  });

  it("disables camera", () => {
    expect(policy).toContain("camera=()");
  });

  it("disables microphone", () => {
    expect(policy).toContain("microphone=()");
  });

  it("disables geolocation", () => {
    expect(policy).toContain("geolocation=()");
  });

  it("disables payment", () => {
    expect(policy).toContain("payment=()");
  });

  it("disables usb", () => {
    expect(policy).toContain("usb=()");
  });

  it("disables browsing-topics", () => {
    expect(policy).toContain("browsing-topics=()");
  });
});

describe("Strict-Transport-Security", () => {
  it("header is present in non-development mode", () => {
    // In the test environment (NODE_ENV=test), the production path is taken
    // and HSTS is included. In development (NODE_ENV=development) it is
    // intentionally omitted to avoid caching HSTS over HTTP.
    expect(headerMap.has("strict-transport-security")).toBe(true);
  });

  it("max-age is at least one year", () => {
    const value = headerMap.get("strict-transport-security") ?? "";
    const match = value.match(/max-age=(\d+)/);
    expect(match).not.toBeNull();
    const maxAge = parseInt(match![1], 10);
    expect(maxAge).toBeGreaterThanOrEqual(31536000);
  });

  it("includes includeSubDomains", () => {
    expect(headerMap.get("strict-transport-security")).toContain(
      "includeSubDomains",
    );
  });
});
