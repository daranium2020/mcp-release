/**
 * Regression tests for ERR_SOCKET_BAD_PORT fix.
 *
 * Root cause: WHATWG URL.port returns "" for default ports (https→443, http→80).
 * The original connector called parseInt("", 10) → NaN, then passed NaN to
 * tls.connect(), which throws RangeError { code: "ERR_SOCKET_BAD_PORT" }.
 *
 * Fix: resolveConnectorPort normalises the empty string to the protocol default
 * and rejects any other non-integer, zero, or out-of-range value.
 */
import { describe, it, expect } from "vitest";
import { resolveConnectorPort } from "../src/transport.js";
import { runCheck } from "../src/check.js";
import { type TransportDiagnostic } from "../src/diagnostics.js";

// ---------------------------------------------------------------------------
// 1. Port normalisation — unit tests for resolveConnectorPort
// ---------------------------------------------------------------------------

describe("resolveConnectorPort — HTTPS defaults", () => {
  it("empty string + HTTPS resolves to 443", () => {
    // new URL("https://example.com/mcp").port === "" — this was the production failure
    expect(resolveConnectorPort("", true)).toBe(443);
  });

  it("empty string + HTTP resolves to 80", () => {
    expect(resolveConnectorPort("", false)).toBe(80);
  });

  it("'443' + HTTPS resolves to 443", () => {
    // new URL("https://example.com:443/mcp").port also normalises to ""
    // so this case only arises for non-default HTTPS ports given as 443 explicitly
    // — but the function must still handle it correctly.
    expect(resolveConnectorPort("443", true)).toBe(443);
  });

  it("'443' + HTTP resolves to 443", () => {
    expect(resolveConnectorPort("443", false)).toBe(443);
  });
});

describe("resolveConnectorPort — explicit non-default ports", () => {
  it("preserves '8443'", () => {
    expect(resolveConnectorPort("8443", true)).toBe(8443);
  });

  it("preserves '8080'", () => {
    expect(resolveConnectorPort("8080", false)).toBe(8080);
  });

  it("preserves '1' (minimum valid port)", () => {
    expect(resolveConnectorPort("1", true)).toBe(1);
  });

  it("preserves '65535' (maximum valid port)", () => {
    expect(resolveConnectorPort("65535", true)).toBe(65535);
  });
});

describe("resolveConnectorPort — return type is always a safe integer", () => {
  it("result is typeof number", () => {
    expect(typeof resolveConnectorPort("", true)).toBe("number");
    expect(typeof resolveConnectorPort("8443", true)).toBe("number");
  });

  it("result is a finite integer — never NaN", () => {
    expect(Number.isFinite(resolveConnectorPort("", true))).toBe(true);
    expect(Number.isFinite(resolveConnectorPort("8443", false))).toBe(true);
    expect(Number.isNaN(resolveConnectorPort("", true))).toBe(false);
  });

  it("result is a safe integer — never NaN, never Infinity", () => {
    expect(Number.isInteger(resolveConnectorPort("", true))).toBe(true);
    expect(Number.isInteger(resolveConnectorPort("8443", true))).toBe(true);
  });
});

describe("resolveConnectorPort — malformed values are rejected", () => {
  it("rejects '0' — zero is not a valid port", () => {
    expect(() => resolveConnectorPort("0", true)).toThrow(RangeError);
  });

  it("rejects '65536' — above maximum", () => {
    expect(() => resolveConnectorPort("65536", true)).toThrow(RangeError);
  });

  it("rejects '99999' — way above maximum", () => {
    expect(() => resolveConnectorPort("99999", true)).toThrow(RangeError);
  });

  it("rejects '-1' — negative port (contains non-digit)", () => {
    expect(() => resolveConnectorPort("-1", true)).toThrow(RangeError);
  });

  it("rejects 'abc' — non-numeric", () => {
    expect(() => resolveConnectorPort("abc", true)).toThrow(RangeError);
  });

  it("rejects '8443.5' — decimal, not integer", () => {
    expect(() => resolveConnectorPort("8443.5", true)).toThrow(RangeError);
  });

  it("rejects 'NaN' — string NaN", () => {
    expect(() => resolveConnectorPort("NaN", true)).toThrow(RangeError);
  });

  it("rejects ' 443' — leading whitespace (no silent coercion)", () => {
    // parseInt would silently parse this to 443; we do not.
    expect(() => resolveConnectorPort(" 443", true)).toThrow(RangeError);
  });

  it("rejects '443 ' — trailing whitespace", () => {
    expect(() => resolveConnectorPort("443 ", true)).toThrow(RangeError);
  });

  it("rejects '1e3' — exponential notation (non-digit chars)", () => {
    expect(() => resolveConnectorPort("1e3", true)).toThrow(RangeError);
  });

  it("does not silently convert malformed port to 443", () => {
    // Throwing proves the value never reaches the socket — not silently 443.
    expect(() => resolveConnectorPort("garbage", true)).toThrow(RangeError);
    expect(() => resolveConnectorPort("0", true)).toThrow(RangeError);
  });
});

describe("resolveConnectorPort — ERR_SOCKET_BAD_PORT regression proof", () => {
  it("never returns NaN (which caused ERR_SOCKET_BAD_PORT)", () => {
    // The production failure: parseInt("", 10) === NaN → tls.connect({ port: NaN }) throws
    const port = resolveConnectorPort("", true);
    expect(Number.isNaN(port)).toBe(false);
    expect(port).toBe(443);
  });

  it("never returns undefined (which also causes ERR_SOCKET_BAD_PORT)", () => {
    const port = resolveConnectorPort("", true);
    expect(port).not.toBeUndefined();
  });

  it("never returns 0 (which also causes ERR_SOCKET_BAD_PORT)", () => {
    const port = resolveConnectorPort("", true);
    expect(port).not.toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Integration — SSRF rejection unchanged
// ---------------------------------------------------------------------------

describe("SSRF rejection — unchanged after port fix", () => {
  it("blocks private IPv4 (10.x.x.x)", async () => {
    const report = await runCheck("https://10.0.0.1/mcp", { timeoutMs: 2000 });
    expect(report.overallStatus).toBe("FAIL");
    expect(report.findings.some((f) => f.code === "SSRF_BLOCKED")).toBe(true);
  }, 5000);

  it("blocks link-local 169.254.x.x", async () => {
    const report = await runCheck("https://169.254.169.254/mcp", { timeoutMs: 2000 });
    expect(report.overallStatus).toBe("FAIL");
    expect(report.findings.some((f) => f.code === "SSRF_BLOCKED")).toBe(true);
  }, 5000);

  it("blocks plain HTTP to external host", async () => {
    const report = await runCheck("http://example.com/mcp", { timeoutMs: 2000 });
    expect(report.overallStatus).toBe("FAIL");
    expect(report.findings.some((f) => f.code === "HTTPS_REQUIRED")).toBe(true);
  }, 5000);
});

// ---------------------------------------------------------------------------
// 3. Integration — diagnostic schema unchanged
// ---------------------------------------------------------------------------

describe("onDiagnostic schema — unchanged after port fix", () => {
  it("emits a fixed-schema diagnostic on connection refused (localhost:1)", async () => {
    const diagnostics: TransportDiagnostic[] = [];
    const report = await runCheck("http://localhost:1/mcp", {
      allowHttp: true,
      timeoutMs: 3000,
      onDiagnostic: (d) => diagnostics.push(d),
    });

    expect(report.overallStatus).toBe("FAIL");
    expect(diagnostics).toHaveLength(1);
    const d = diagnostics[0]!;

    // Schema fields all present
    expect(d).toHaveProperty("phase");
    expect(d).toHaveProperty("errorName");
    expect(d).toHaveProperty("errorCode");
    expect(d).toHaveProperty("causeName");
    expect(d).toHaveProperty("causeCode");
    expect(d).toHaveProperty("causeSyscall");
    expect(d).toHaveProperty("selectedIpFamily");
    expect(d).toHaveProperty("safeMessage");

    // safeMessage is code-only or "unclassified" — never raw message text
    expect(d.safeMessage).not.toMatch(/localhost/i);
    expect(d.safeMessage).not.toMatch(/127\.\d+/);
  }, 8000);

  it("client-facing TRANSPORT_ERROR finding remains generic", async () => {
    const report = await runCheck("http://localhost:1/mcp", {
      allowHttp: true,
      timeoutMs: 3000,
    });
    const finding = report.findings.find((f) => f.code === "TRANSPORT_ERROR");
    expect(finding).toBeDefined();
    expect(finding!.message).not.toContain('"causeCode"');
    expect(finding!.message).not.toContain('"phase"');
  }, 8000);
});
