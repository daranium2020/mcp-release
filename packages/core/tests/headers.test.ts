/**
 * Tests for header validation, request-header passthrough, and SSRF policy.
 *
 * The web API never passes requestHeaders or allowPrivateNetworks to runCheck.
 * The CLI and GitHub Action do. These tests verify that:
 *   - Header values reach the server when provided.
 *   - Without the correct token, an auth-required server returns AUTH_REQUIRED.
 *   - With the correct token, validation completes successfully.
 *   - The web path (no headers, no private-network flag) is unchanged.
 *   - SSRF still blocks private IPs when allowPrivateNetworks is false.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCheck } from "../src/check.js";
import {
  validateHeaderName,
  validateHeaderValue,
  parseHeaderLiteralFlag,
  parseHeaderEnvFlag,
  buildRequestHeaders,
  HeaderValidationError,
} from "../src/headers.js";
import {
  startAuthenticatedServer,
  startUnauthorizedServer,
  type FixtureServer,
} from "../../../fixtures/servers/src/index.js";

// ---------------------------------------------------------------------------
// 1. Header name validation
// ---------------------------------------------------------------------------

describe("validateHeaderName", () => {
  it("accepts valid HTTP token characters", () => {
    expect(() => validateHeaderName("Authorization")).not.toThrow();
    expect(() => validateHeaderName("X-API-Key")).not.toThrow();
    expect(() => validateHeaderName("x-custom-header")).not.toThrow();
    expect(() => validateHeaderName("Content-Type")).not.toThrow();
  });

  it("rejects empty name", () => {
    expect(() => validateHeaderName("")).toThrow(HeaderValidationError);
  });

  it("rejects names with spaces", () => {
    expect(() => validateHeaderName("My Header")).toThrow(HeaderValidationError);
  });

  it("rejects names with colon", () => {
    expect(() => validateHeaderName("Bad:Name")).toThrow(HeaderValidationError);
  });
});

// ---------------------------------------------------------------------------
// 2. Header value validation
// ---------------------------------------------------------------------------

describe("validateHeaderValue", () => {
  it("accepts normal values", () => {
    expect(() => validateHeaderValue("Authorization", "Bearer abc123")).not.toThrow();
    expect(() => validateHeaderValue("X-API-Key", "my-key-value")).not.toThrow();
  });

  it("rejects values with CR", () => {
    expect(() => validateHeaderValue("X-Test", "value\rwith-cr")).toThrow(HeaderValidationError);
  });

  it("rejects values with LF", () => {
    expect(() => validateHeaderValue("X-Test", "value\nwith-lf")).toThrow(HeaderValidationError);
  });

  it("rejects values with CRLF", () => {
    expect(() => validateHeaderValue("X-Test", "value\r\ninjection")).toThrow(HeaderValidationError);
  });
});

// ---------------------------------------------------------------------------
// 3. parseHeaderLiteralFlag
// ---------------------------------------------------------------------------

describe("parseHeaderLiteralFlag", () => {
  it("parses 'Authorization: Bearer token'", () => {
    const [name, value] = parseHeaderLiteralFlag("Authorization: Bearer token");
    expect(name).toBe("Authorization");
    expect(value).toBe("Bearer token");
  });

  it("parses 'X-API-Key: my-key'", () => {
    const [name, value] = parseHeaderLiteralFlag("X-API-Key: my-key");
    expect(name).toBe("X-API-Key");
    expect(value).toBe("my-key");
  });

  it("handles missing colon by throwing", () => {
    expect(() => parseHeaderLiteralFlag("Authorization Bearer token")).toThrow(
      HeaderValidationError,
    );
  });

  it("trims whitespace from name and value", () => {
    const [name, value] = parseHeaderLiteralFlag("X-Custom :  trimmed ");
    expect(name).toBe("X-Custom");
    expect(value).toBe("trimmed");
  });
});

// ---------------------------------------------------------------------------
// 4. parseHeaderEnvFlag
// ---------------------------------------------------------------------------

describe("parseHeaderEnvFlag", () => {
  it("reads value from env", () => {
    const env = { MY_TOKEN: "secret-value" };
    const [name, value] = parseHeaderEnvFlag("Authorization=MY_TOKEN", env);
    expect(name).toBe("Authorization");
    expect(value).toBe("secret-value");
  });

  it("throws when env var is not set", () => {
    expect(() => parseHeaderEnvFlag("Authorization=MISSING_VAR", {})).toThrow(
      HeaderValidationError,
    );
  });

  it("throws when format has no '=' separator", () => {
    expect(() => parseHeaderEnvFlag("AuthorizationMY_TOKEN", {})).toThrow(
      HeaderValidationError,
    );
  });
});

// ---------------------------------------------------------------------------
// 5. buildRequestHeaders
// ---------------------------------------------------------------------------

describe("buildRequestHeaders", () => {
  it("returns empty object when no flags", () => {
    const headers = buildRequestHeaders([], [], undefined, {});
    expect(headers).toEqual({});
  });

  it("builds headers from literals", () => {
    const headers = buildRequestHeaders(
      ["X-Custom: my-value", "Accept-Language: en"],
      [],
      undefined,
      {},
    );
    expect(headers["X-Custom"]).toBe("my-value");
    expect(headers["Accept-Language"]).toBe("en");
  });

  it("builds Authorization from bearer-token-env", () => {
    const headers = buildRequestHeaders([], [], "TOKEN_VAR", { TOKEN_VAR: "abc" });
    expect(headers["Authorization"]).toBe("Bearer abc");
  });

  it("throws when bearer env var is missing", () => {
    expect(() => buildRequestHeaders([], [], "MISSING", {})).toThrow(
      HeaderValidationError,
    );
  });

  it("throws when bearer token contains newline", () => {
    expect(() =>
      buildRequestHeaders([], [], "TOKEN_VAR", { TOKEN_VAR: "bad\ntoken" }),
    ).toThrow(HeaderValidationError);
  });

  it("later entries overwrite earlier ones for the same header", () => {
    const headers = buildRequestHeaders(
      ["Authorization: Bearer old"],
      [],
      "AUTH_VAR",
      { AUTH_VAR: "new-token" },
    );
    expect(headers["Authorization"]).toBe("Bearer new-token");
  });
});

// ---------------------------------------------------------------------------
// 6. runCheck with authenticated server (requires correct Bearer token)
// ---------------------------------------------------------------------------

describe("runCheck — authenticated server", () => {
  let authServer: FixtureServer;
  const TOKEN = "test-secret-token-abc123";

  beforeAll(async () => {
    authServer = await startAuthenticatedServer(TOKEN);
  });
  afterAll(async () => authServer.close());

  it("returns AUTH_REQUIRED when no token is provided", async () => {
    const report = await runCheck(authServer.url, { allowHttp: true, allowPrivateNetworks: true });
    expect(report.overallStatus).toBe("WARNING");
    expect(report.findings.some((f) => f.code === "AUTH_REQUIRED")).toBe(true);
  });

  it("returns PASS when correct bearer token is provided", async () => {
    const report = await runCheck(authServer.url, {
      allowHttp: true,
      allowPrivateNetworks: true,
      requestHeaders: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(report.overallStatus).toBe("PASS");
    expect(report.findings.some((f) => f.code === "INIT_OK")).toBe(true);
    expect(report.tools).toHaveLength(1);
    expect(report.tools[0]?.name).toBe("secure_tool");
  });

  it("returns AUTH_REQUIRED when wrong token is provided", async () => {
    const report = await runCheck(authServer.url, {
      allowHttp: true,
      allowPrivateNetworks: true,
      requestHeaders: { Authorization: "Bearer wrong-token" },
    });
    expect(report.overallStatus).toBe("WARNING");
    expect(report.findings.some((f) => f.code === "AUTH_REQUIRED")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Web path remains unchanged (no requestHeaders, no allowPrivateNetworks)
// ---------------------------------------------------------------------------

describe("runCheck — web path (no auth options)", () => {
  let unauthServer: FixtureServer;

  beforeAll(async () => {
    unauthServer = await startUnauthorizedServer();
  });
  afterAll(async () => unauthServer.close());

  it("returns AUTH_REQUIRED for a 401 server (web behavior unchanged)", async () => {
    // Simulate how the web API calls runCheck: no requestHeaders, no allowPrivateNetworks
    const report = await runCheck(unauthServer.url, { allowHttp: true });
    expect(report.overallStatus).toBe("WARNING");
    expect(report.findings.some((f) => f.code === "AUTH_REQUIRED")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. SSRF: private networks still blocked when allowPrivateNetworks is false
// ---------------------------------------------------------------------------

describe("SSRF — private network blocked when allowPrivateNetworks is false", () => {
  it("blocks HTTPS connection to a private IP address", async () => {
    const report = await runCheck("https://192.168.1.1/mcp");
    expect(report.overallStatus).toBe("FAIL");
    const hasSsrfFinding = report.findings.some(
      (f) => f.code === "SSRF_BLOCKED" || f.code === "BLOCKED_IP",
    );
    expect(hasSsrfFinding).toBe(true);
  });
});
