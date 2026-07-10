import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseInputs } from "../src/inputs.js";

vi.mock("@actions/core", () => ({
  getInput: vi.fn(),
  setOutput: vi.fn(),
  setFailed: vi.fn(),
  setSecret: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  summary: {
    addHeading: vi.fn().mockReturnThis(),
    addRaw: vi.fn().mockReturnThis(),
    write: vi.fn().mockResolvedValue(undefined),
  },
}));

import * as core from "@actions/core";

function setInputs(inputs: Record<string, string>): void {
  const mockGetInput = core.getInput as ReturnType<typeof vi.fn>;
  mockGetInput.mockImplementation((name: string) => inputs[name] ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
  // Unset any environment variables that might affect tests
  delete process.env["TEST_TOKEN"];
  delete process.env["TEST_API_KEY"];
});

describe("parseInputs", () => {
  it("parses minimal valid inputs with defaults", () => {
    setInputs({ endpoint: "https://example.com/mcp" });
    const inputs = parseInputs();
    expect(inputs.endpoint).toBe("https://example.com/mcp");
    expect(inputs.timeoutMs).toBe(10000);
    expect(inputs.failOn).toBe("FAIL");
    expect(inputs.format).toBe("markdown");
    expect(inputs.outputDirectory).toBe("");
    expect(inputs.developmentMode).toBe(false);
    expect(inputs.requestHeaders).toEqual({});
  });

  it("parses all non-auth inputs explicitly", () => {
    setInputs({
      endpoint: "https://my-server.example.com/mcp",
      "timeout-ms": "5000",
      "fail-on": "warning",
      format: "both",
      "output-directory": "/tmp/reports",
      "development-mode": "true",
    });
    const inputs = parseInputs();
    expect(inputs.timeoutMs).toBe(5000);
    expect(inputs.failOn).toBe("WARNING");
    expect(inputs.format).toBe("both");
    expect(inputs.outputDirectory).toBe("/tmp/reports");
    expect(inputs.developmentMode).toBe(true);
  });

  it("throws on missing endpoint", () => {
    const mockGetInput = core.getInput as ReturnType<typeof vi.fn>;
    mockGetInput.mockImplementation((_name: string, opts?: { required?: boolean }) => {
      if (opts?.required) throw new Error("Input required and not supplied: endpoint");
      return "";
    });
    expect(() => parseInputs()).toThrow();
  });

  it("throws on invalid URL endpoint", () => {
    setInputs({ endpoint: "not-a-url" });
    expect(() => parseInputs()).toThrow(/not a valid URL/);
  });

  it("throws on non-positive timeout", () => {
    setInputs({ endpoint: "https://example.com/mcp", "timeout-ms": "-100" });
    expect(() => parseInputs()).toThrow(/timeout-ms/);
  });

  it("throws on timeout exceeding maximum", () => {
    setInputs({ endpoint: "https://example.com/mcp", "timeout-ms": "999999" });
    expect(() => parseInputs()).toThrow(/timeout-ms/);
  });

  it("throws on invalid fail-on value", () => {
    setInputs({ endpoint: "https://example.com/mcp", "fail-on": "error" });
    expect(() => parseInputs()).toThrow(/fail-on/);
  });

  it("throws on invalid format value", () => {
    setInputs({ endpoint: "https://example.com/mcp", format: "xml" });
    expect(() => parseInputs()).toThrow(/format/);
  });

  it("returns redacted safeEndpoint when URL has token param", () => {
    setInputs({ endpoint: "https://example.com/mcp?token=supersecret" });
    const inputs = parseInputs();
    expect(inputs.safeEndpoint).not.toContain("supersecret");
    expect(inputs.safeEndpoint).toContain("[REDACTED]");
  });

  it("case-insensitive fail-on and format", () => {
    setInputs({ endpoint: "https://example.com/mcp", "fail-on": "WARNING", format: "JSON" });
    const inputs = parseInputs();
    expect(inputs.failOn).toBe("WARNING");
    expect(inputs.format).toBe("json");
  });
});

// ---------------------------------------------------------------------------
// Auth input parsing
// ---------------------------------------------------------------------------

describe("parseInputs — bearer-token-env", () => {
  it("builds Authorization header from env var", () => {
    process.env["TEST_TOKEN"] = "secret-bearer-token";
    setInputs({
      endpoint: "https://example.com/mcp",
      "bearer-token-env": "TEST_TOKEN",
    });
    const inputs = parseInputs();
    expect(inputs.requestHeaders["Authorization"]).toBe("Bearer secret-bearer-token");
    delete process.env["TEST_TOKEN"];
  });

  it("throws when the referenced env var is not set", () => {
    delete process.env["MISSING_VAR"];
    setInputs({
      endpoint: "https://example.com/mcp",
      "bearer-token-env": "MISSING_VAR",
    });
    expect(() => parseInputs()).toThrow(/MISSING_VAR/);
  });

  it("calls core.setSecret for the bearer token value", () => {
    process.env["TEST_TOKEN"] = "my-secret-value";
    setInputs({
      endpoint: "https://example.com/mcp",
      "bearer-token-env": "TEST_TOKEN",
    });
    parseInputs();
    expect(core.setSecret).toHaveBeenCalledWith("my-secret-value");
    delete process.env["TEST_TOKEN"];
  });
});

describe("parseInputs — header (literal)", () => {
  it("parses newline-separated literal headers", () => {
    setInputs({
      endpoint: "https://example.com/mcp",
      header: "X-Tenant: acme\nX-Version: 2",
    });
    const inputs = parseInputs();
    expect(inputs.requestHeaders["X-Tenant"]).toBe("acme");
    expect(inputs.requestHeaders["X-Version"]).toBe("2");
  });

  it("ignores blank lines in header input", () => {
    setInputs({
      endpoint: "https://example.com/mcp",
      header: "\nX-Tenant: acme\n\n",
    });
    const inputs = parseInputs();
    expect(inputs.requestHeaders["X-Tenant"]).toBe("acme");
    expect(Object.keys(inputs.requestHeaders)).toHaveLength(1);
  });

  it("throws on invalid header name in literal", () => {
    setInputs({
      endpoint: "https://example.com/mcp",
      header: "Bad Name: value",
    });
    expect(() => parseInputs()).toThrow();
  });
});

describe("parseInputs — header-env", () => {
  it("reads header value from environment variable", () => {
    process.env["TEST_API_KEY"] = "api-key-value-123";
    setInputs({
      endpoint: "https://example.com/mcp",
      "header-env": "X-API-Key=TEST_API_KEY",
    });
    const inputs = parseInputs();
    expect(inputs.requestHeaders["X-API-Key"]).toBe("api-key-value-123");
    delete process.env["TEST_API_KEY"];
  });

  it("calls core.setSecret for sensitive header values from env", () => {
    process.env["TEST_API_KEY"] = "sensitive-api-key";
    setInputs({
      endpoint: "https://example.com/mcp",
      "header-env": "X-API-Key=TEST_API_KEY",
    });
    parseInputs();
    expect(core.setSecret).toHaveBeenCalledWith("sensitive-api-key");
    delete process.env["TEST_API_KEY"];
  });

  it("throws when the referenced env var is not set", () => {
    delete process.env["MISSING_VAR"];
    setInputs({
      endpoint: "https://example.com/mcp",
      "header-env": "X-Custom=MISSING_VAR",
    });
    expect(() => parseInputs()).toThrow(/MISSING_VAR/);
  });
});

describe("parseInputs — no secret values in error messages", () => {
  it("error for missing env var does not expose other env var values", () => {
    process.env["OTHER_SECRET"] = "ultra-secret";
    setInputs({
      endpoint: "https://example.com/mcp",
      "bearer-token-env": "DEFINITELY_NOT_SET",
    });
    try {
      parseInputs();
    } catch (err) {
      expect((err as Error).message).not.toContain("ultra-secret");
    }
    delete process.env["OTHER_SECRET"];
  });
});
