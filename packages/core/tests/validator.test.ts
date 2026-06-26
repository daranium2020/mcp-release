import { describe, it, expect } from "vitest";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { validateTool, validateTools } from "../src/validator.js";

function makeTool(overrides: Partial<Tool> & Record<string, unknown> = {}): Tool {
  return {
    name: "my_tool",
    description: "Does something useful",
    inputSchema: { type: "object", properties: {} },
    ...overrides,
  } as Tool;
}

describe("validateTool", () => {
  it("passes a well-formed tool", () => {
    const result = validateTool(makeTool());
    expect(result.overallStatus).toBe("PASS");
    expect(result.findings.some((f) => f.code === "TOOL_OK")).toBe(true);
  });

  it("fails an empty tool name", () => {
    const result = validateTool(makeTool({ name: "" }));
    expect(result.overallStatus).toBe("FAIL");
    expect(result.findings.some((f) => f.code === "TOOL_INVALID_NAME")).toBe(true);
  });

  it("fails a tool name with spaces", () => {
    const result = validateTool(makeTool({ name: "invalid name" }));
    expect(result.overallStatus).toBe("FAIL");
    expect(result.findings.some((f) => f.code === "TOOL_INVALID_NAME")).toBe(true);
  });

  it("allows underscores, hyphens, dots in tool names", () => {
    expect(validateTool(makeTool({ name: "my_tool" })).overallStatus).toBe("PASS");
    expect(validateTool(makeTool({ name: "my-tool" })).overallStatus).toBe("PASS");
    expect(validateTool(makeTool({ name: "my.tool" })).overallStatus).toBe("PASS");
  });

  it("warns on missing description", () => {
    const tool = { name: "no_desc", inputSchema: { type: "object" } } as unknown as Tool;
    const result = validateTool(tool);
    expect(result.overallStatus).toBe("WARNING");
    expect(result.findings.some((f) => f.code === "TOOL_MISSING_DESCRIPTION")).toBe(true);
  });

  it("warns on empty description", () => {
    const result = validateTool(makeTool({ description: "   " }));
    expect(result.overallStatus).toBe("WARNING");
    expect(result.findings.some((f) => f.code === "TOOL_EMPTY_DESCRIPTION")).toBe(true);
  });

  it("fails an invalid inputSchema (string instead of object)", () => {
    const result = validateTool(
      makeTool({ inputSchema: "not-a-schema" as unknown as Tool["inputSchema"] }),
    );
    expect(result.overallStatus).toBe("FAIL");
    expect(result.findings.some((f) => f.code === "TOOL_INVALID_INPUT_SCHEMA")).toBe(true);
  });

  it("fails an invalid outputSchema", () => {
    const result = validateTool(
      makeTool({ outputSchema: ["not", "a", "schema"] } as unknown as Tool),
    );
    expect(result.overallStatus).toBe("FAIL");
    expect(result.findings.some((f) => f.code === "TOOL_INVALID_OUTPUT_SCHEMA")).toBe(true);
  });
});

describe("validateTools", () => {
  it("detects duplicate tool names", () => {
    const tools = [makeTool({ name: "dup" }), makeTool({ name: "dup" })];
    const { topLevelFindings } = validateTools(tools);
    expect(topLevelFindings.some((f) => f.code === "TOOL_DUPLICATE_NAME")).toBe(true);
  });

  it("passes with unique tool names", () => {
    const tools = [makeTool({ name: "tool_a" }), makeTool({ name: "tool_b" })];
    const { topLevelFindings } = validateTools(tools);
    expect(topLevelFindings).toHaveLength(0);
  });
});
