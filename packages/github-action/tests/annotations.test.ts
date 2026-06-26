import { describe, it, expect, vi, beforeEach } from "vitest";
import { emitAnnotations } from "../src/annotations.js";
import type { Finding } from "@mcp-launch/core";

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

function finding(severity: Finding["severity"], code: Finding["code"], message: string): Finding {
  return { severity, code, message };
}

beforeEach(() => vi.clearAllMocks());

describe("emitAnnotations", () => {
  it("emits error for FAIL findings", () => {
    emitAnnotations([finding("FAIL", "TRANSPORT_ERROR", "connection failed")]);
    expect(core.error).toHaveBeenCalledOnce();
    expect(core.warning).not.toHaveBeenCalled();
  });

  it("emits warning for WARNING findings", () => {
    emitAnnotations([finding("WARNING", "TOOL_MISSING_DESCRIPTION", "no description")]);
    expect(core.warning).toHaveBeenCalledOnce();
    expect(core.error).not.toHaveBeenCalled();
  });

  it("emits nothing for PASS findings", () => {
    emitAnnotations([finding("PASS", "INIT_OK", "all good")]);
    expect(core.error).not.toHaveBeenCalled();
    expect(core.warning).not.toHaveBeenCalled();
  });

  it("emits multiple annotations for multiple findings", () => {
    emitAnnotations([
      finding("FAIL", "TRANSPORT_ERROR", "fail 1"),
      finding("WARNING", "TOOL_MISSING_DESCRIPTION", "warn 1"),
      finding("PASS", "TOOL_OK", "pass"),
      finding("FAIL", "SSRF_BLOCKED", "fail 2"),
    ]);
    expect(core.error).toHaveBeenCalledTimes(2);
    expect(core.warning).toHaveBeenCalledTimes(1);
  });

  it("includes tool name in title when provided", () => {
    emitAnnotations([finding("FAIL", "TOOL_INVALID_NAME", "bad name")], "my_tool");
    expect(core.error).toHaveBeenCalledWith(
      "bad name",
      expect.objectContaining({ title: expect.stringContaining("my_tool") }),
    );
  });

  it("uses server title when no tool name", () => {
    emitAnnotations([finding("FAIL", "TRANSPORT_ERROR", "err")]);
    expect(core.error).toHaveBeenCalledWith(
      "err",
      expect.objectContaining({ title: expect.stringContaining("MCP server") }),
    );
  });
});
