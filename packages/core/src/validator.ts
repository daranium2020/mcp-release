import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { validateJsonSchema } from "./schema-validator.js";
import {
  type Finding,
  type FindingSeverity,
  type ToolReport,
  makeFinding,
  worstSeverity,
} from "./report.js";

// Tool name: non-empty, only safe identifier characters
const TOOL_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_\-./]*$/;

export function validateTool(tool: Tool): ToolReport {
  const findings: Finding[] = [];
  const name = tool.name;

  // Name validation
  if (!name || name.trim() === "") {
    findings.push(
      makeFinding("TOOL_INVALID_NAME", "FAIL", "Tool name is empty", {
        toolName: name,
      }),
    );
  } else if (!TOOL_NAME_PATTERN.test(name)) {
    findings.push(
      makeFinding(
        "TOOL_INVALID_NAME",
        "FAIL",
        `Tool name contains invalid characters: "${name}"`,
        { toolName: name },
      ),
    );
  }

  // Description validation
  if (tool.description === undefined || tool.description === null) {
    findings.push(
      makeFinding(
        "TOOL_MISSING_DESCRIPTION",
        "WARNING",
        `Tool "${name}" has no description`,
        { toolName: name },
      ),
    );
  } else if (tool.description.trim() === "") {
    findings.push(
      makeFinding(
        "TOOL_EMPTY_DESCRIPTION",
        "WARNING",
        `Tool "${name}" has an empty description`,
        { toolName: name },
      ),
    );
  }

  // Input schema validation
  const inputSchema: unknown = tool.inputSchema;
  if (inputSchema === undefined || inputSchema === null) {
    findings.push(
      makeFinding(
        "TOOL_INVALID_INPUT_SCHEMA",
        "FAIL",
        `Tool "${name}" has no inputSchema`,
        { toolName: name },
      ),
    );
  } else {
    const result = validateJsonSchema(inputSchema, `tool "${name}" inputSchema`);
    if (!result.valid) {
      const severity: FindingSeverity = result.isUnsupportedDraft
        ? "WARNING"
        : "FAIL";
      for (const error of result.errors) {
        findings.push(
          makeFinding(
            result.isUnsupportedDraft
              ? "TOOL_UNSUPPORTED_SCHEMA_DRAFT"
              : "TOOL_INVALID_INPUT_SCHEMA",
            severity,
            error,
            { toolName: name },
          ),
        );
      }
    }
  }

  // Output schema validation (optional field)
  const outputSchema: unknown = (tool as Record<string, unknown>)["outputSchema"];
  if (outputSchema !== undefined && outputSchema !== null) {
    const result = validateJsonSchema(outputSchema, `tool "${name}" outputSchema`);
    if (!result.valid) {
      const severity: FindingSeverity = result.isUnsupportedDraft
        ? "WARNING"
        : "FAIL";
      for (const error of result.errors) {
        findings.push(
          makeFinding(
            result.isUnsupportedDraft
              ? "TOOL_UNSUPPORTED_SCHEMA_DRAFT"
              : "TOOL_INVALID_OUTPUT_SCHEMA",
            severity,
            error,
            { toolName: name },
          ),
        );
      }
    }
  }

  if (findings.length === 0) {
    findings.push(
      makeFinding("TOOL_OK", "PASS", `Tool "${name}" passed all checks`, {
        toolName: name,
      }),
    );
  }

  return {
    name,
    findings,
    overallStatus: worstSeverity(findings),
  };
}

export function validateTools(tools: Tool[]): {
  toolReports: ToolReport[];
  topLevelFindings: Finding[];
} {
  const topLevelFindings: Finding[] = [];
  const toolReports: ToolReport[] = [];

  // Check for duplicate names
  const seenNames = new Map<string, number>();
  for (const tool of tools) {
    const count = seenNames.get(tool.name) ?? 0;
    seenNames.set(tool.name, count + 1);
  }
  for (const [name, count] of seenNames.entries()) {
    if (count > 1) {
      topLevelFindings.push(
        makeFinding(
          "TOOL_DUPLICATE_NAME",
          "FAIL",
          `Tool name "${name}" appears ${count} times`,
          { toolName: name, count },
        ),
      );
    }
  }

  for (const tool of tools) {
    toolReports.push(validateTool(tool));
  }

  return { toolReports, topLevelFindings };
}
