import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCheck } from "../src/check.js";
import { redactUrl, redactString, redactErrorMessage } from "../src/redact.js";
import {
  startPrivateRedirectServer,
  startRedirectLoopServer,
  startOversizedResponseServer,
  type FixtureServer,
} from "../../../fixtures/servers/src/index.js";

const DEV = { allowHttp: true };

// ---------------------------------------------------------------------------
// Redirect to private address
// ---------------------------------------------------------------------------

describe("redirect to private address", () => {
  let server: FixtureServer;
  beforeAll(async () => { server = await startPrivateRedirectServer(); });
  afterAll(async () => server.close());

  it("is blocked with SSRF_BLOCKED or TRANSPORT_ERROR", async () => {
    const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
    expect(report.overallStatus).toBe("FAIL");
    const failCodes = ["SSRF_BLOCKED", "TRANSPORT_ERROR"];
    expect(report.findings.some((f) => failCodes.includes(f.code))).toBe(true);
  }, 8000);
});

// ---------------------------------------------------------------------------
// Redirect loop
// ---------------------------------------------------------------------------

describe("redirect loop", () => {
  let server: FixtureServer;
  beforeAll(async () => { server = await startRedirectLoopServer(); });
  afterAll(async () => server.close());

  it("is detected and reported as FAIL", async () => {
    const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
    expect(report.overallStatus).toBe("FAIL");
    // May be reported as REDIRECT_LOOP, REDIRECT_LIMIT_EXCEEDED, or TRANSPORT_ERROR
    const failCodes = ["REDIRECT_LOOP", "REDIRECT_LIMIT_EXCEEDED", "TRANSPORT_ERROR"];
    expect(report.findings.some((f) => failCodes.includes(f.code))).toBe(true);
  }, 8000);
});

// ---------------------------------------------------------------------------
// Oversized response
// ---------------------------------------------------------------------------

describe("oversized response", () => {
  let server: FixtureServer;
  beforeAll(async () => { server = await startOversizedResponseServer(); });
  afterAll(async () => server.close());

  it("is rejected as FAIL", async () => {
    const report = await runCheck(server.url, { ...DEV, timeoutMs: 3000 });
    expect(report.overallStatus).toBe("FAIL");
    const failCodes = ["TRANSPORT_ERROR", "REQUEST_SIZE_LIMIT", "TIMEOUT"];
    expect(report.findings.some((f) => failCodes.includes(f.code))).toBe(true);
  }, 8000);
});

// ---------------------------------------------------------------------------
// Secret redaction
// ---------------------------------------------------------------------------

describe("secret redaction", () => {
  it("redacts bearer tokens from URLs", () => {
    const url = "https://example.com/mcp?token=my-super-secret";
    const safe = redactUrl(url);
    expect(safe).not.toContain("my-super-secret");
    expect(safe).toContain("[REDACTED]");
  });

  it("redacts API key query parameters", () => {
    const url = "https://example.com/mcp?api_key=sk-abc123&other=ok";
    const safe = redactUrl(url);
    expect(safe).not.toContain("sk-abc123");
    expect(safe).toContain("other=ok");
  });

  it("redacts bearer tokens from strings", () => {
    const msg = "Failed: Authorization: Bearer eyJhbGciOiJSUzI1NiJ9.payload";
    const safe = redactString(msg);
    expect(safe).not.toContain("eyJhbGciOiJSUzI1NiJ9");
    expect(safe).toContain("[REDACTED]");
  });

  it("redacts secrets from error messages", () => {
    const err = new Error("Connection failed token=supersecret reason=timeout");
    const safe = redactErrorMessage(err);
    expect(safe).not.toContain("supersecret");
    expect(safe).toContain("[REDACTED]");
  });

  it("redacts key= patterns from error messages", () => {
    const err = new Error("Auth failed key=myPrivateKey123");
    const safe = redactErrorMessage(err);
    expect(safe).not.toContain("myPrivateKey123");
  });

  it("preserves non-sensitive URL query parameters", () => {
    const url = "https://example.com/mcp?version=2&format=json";
    const safe = redactUrl(url);
    expect(safe).toContain("version=2");
    expect(safe).toContain("format=json");
    expect(safe).not.toContain("[REDACTED]");
  });
});
