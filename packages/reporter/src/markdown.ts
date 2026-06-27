import type { CheckReport, Finding } from "@mcp-release/core";

function severityBadge(s: string): string {
  if (s === "FAIL") return "🔴 FAIL";
  if (s === "WARNING") return "🟡 WARNING";
  return "🟢 PASS";
}

function findingsTable(findings: Finding[]): string {
  if (findings.length === 0) return "_No findings._\n";
  const header = "| Severity | Code | Message |\n|---|---|---|";
  const rows = findings
    .map((f) => `| ${severityBadge(f.severity)} | \`${f.code}\` | ${f.message} |`)
    .join("\n");
  return `${header}\n${rows}\n`;
}

export function toMarkdown(report: CheckReport): string {
  const lines: string[] = [];

  lines.push(`## MCP Release Report`);
  lines.push(``);
  lines.push(`**Server:** \`${report.serverUrl}\``);
  lines.push(`**Status:** ${severityBadge(report.overallStatus)}`);
  lines.push(`**Checked at:** ${report.checkedAt}`);
  lines.push(`**Duration:** ${report.durationMs}ms`);
  if (report.protocolVersion) {
    lines.push(`**Protocol version:** ${report.protocolVersion}`);
  }
  lines.push(``);

  lines.push(`### Findings`);
  lines.push(``);
  lines.push(findingsTable(report.findings));

  if (report.tools.length > 0) {
    lines.push(`### Tools (${report.tools.length})`);
    lines.push(``);
    for (const tool of report.tools) {
      lines.push(`#### \`${tool.name}\` — ${severityBadge(tool.overallStatus)}`);
      lines.push(``);
      lines.push(findingsTable(tool.findings));
    }
  }

  return lines.join("\n");
}
