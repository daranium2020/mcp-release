import type { CheckReport, Finding, FindingCode } from "@mcp-release/core";
import { REMEDIATION } from "./remediation.js";

function severityBadge(s: string): string {
  if (s === "FAIL") return "🔴 FAIL";
  if (s === "WARNING") return "🟡 WARNING";
  return "🟢 PASS";
}

function findingsTable(findings: Finding[]): string {
  if (findings.length === 0) return "_No findings._\n";
  const hasRemediation = findings.some((f) => REMEDIATION[f.code as FindingCode] !== undefined);
  if (hasRemediation) {
    const header = "| Severity | Code | Message | Remediation |\n|---|---|---|---|";
    const rows = findings
      .map((f) => {
        const rem = REMEDIATION[f.code as FindingCode] ?? "";
        return `| ${severityBadge(f.severity)} | \`${f.code}\` | ${f.message} | ${rem} |`;
      })
      .join("\n");
    return `${header}\n${rows}\n`;
  }
  const header = "| Severity | Code | Message |\n|---|---|---|";
  const rows = findings
    .map((f) => `| ${severityBadge(f.severity)} | \`${f.code}\` | ${f.message} |`)
    .join("\n");
  return `${header}\n${rows}\n`;
}

export function toMarkdown(report: CheckReport): string {
  const lines: string[] = [];

  const allFindings = [...report.findings, ...report.tools.flatMap((t) => t.findings)];
  const passCount = allFindings.filter((f) => f.severity === "PASS").length;
  const warnCount = allFindings.filter((f) => f.severity === "WARNING").length;
  const failCount = allFindings.filter((f) => f.severity === "FAIL").length;

  lines.push(`## MCP Release Report`);
  lines.push(``);
  lines.push(`**Server:** \`${report.serverUrl}\``);
  lines.push(`**Status:** ${severityBadge(report.overallStatus)}`);

  const transportLabel =
    report.transportType === "stdio"
      ? "stdio (local process)"
      : report.transportType === "http"
        ? "HTTP/SSE"
        : null;
  if (transportLabel) {
    lines.push(`**Transport:** ${transportLabel}`);
  }

  if (report.mcpReleaseVersion) {
    lines.push(`**MCP Release:** v${report.mcpReleaseVersion}`);
  }

  lines.push(`**Started at:** ${report.startedAt ?? report.checkedAt}`);
  lines.push(`**Duration:** ${report.durationMs}ms`);

  if (report.protocolVersion) {
    lines.push(`**Protocol version:** ${report.protocolVersion}`);
  }

  lines.push(``);
  lines.push(`| Passed | Warnings | Failures |`);
  lines.push(`|---|---|---|`);
  lines.push(`| ${passCount} | ${warnCount} | ${failCount} |`);
  lines.push(``);

  if (report.transportType === "stdio") {
    lines.push(
      `> **Security:** Credentials are sent only to the configured MCP endpoint. They are never sent to or stored by MCP Release. Scenario execution and report generation run locally in the CLI or GitHub Actions runner.`,
    );
    lines.push(``);
    if (report.tools.length > 0) {
      lines.push(`> **Note:** Tools were discovered but not invoked.`);
      lines.push(``);
    }
  }

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
