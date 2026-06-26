import * as core from "@actions/core";
import type { Finding } from "@mcp-launch/core";

/**
 * Emit GitHub annotations for all WARNING and FAIL findings.
 * PASS findings are silent.
 * toolName is set when the finding belongs to a specific tool.
 */
export function emitAnnotations(
  findings: Finding[],
  toolName?: string,
): void {
  for (const f of findings) {
    if (f.severity !== "WARNING" && f.severity !== "FAIL") continue;

    const title = toolName
      ? `MCP tool "${toolName}" — ${f.code}`
      : `MCP server — ${f.code}`;

    const props = { title };
    if (f.severity === "FAIL") {
      core.error(f.message, props);
    } else {
      core.warning(f.message, props);
    }
  }
}
