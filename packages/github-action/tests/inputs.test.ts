import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseInputs } from "../src/inputs.js";

vi.mock("@actions/core", () => ({
  getInput: vi.fn(),
  setOutput: vi.fn(),
  setFailed: vi.fn(),
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
  });

  it("parses all inputs explicitly", () => {
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
