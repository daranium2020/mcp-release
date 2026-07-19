import type { ConfigReport, ScenarioResult } from "@mcp-release/core";

function statusBadge(matched: boolean): string {
  return matched ? "🟢 PASS" : "🔴 FAIL";
}

function statusBadgeSeverity(s: string): string {
  if (s === "FAIL") return "🔴 FAIL";
  if (s === "WARNING") return "🟡 WARNING";
  return "🟢 PASS";
}

function formatExpected(s: ScenarioResult): string {
  const parts: string[] = [];
  if (s.expected.result) parts.push(`result: ${s.expected.result}`);
  if (s.expected.httpStatus !== undefined) parts.push(`HTTP ${s.expected.httpStatus}`);
  return parts.join(", ") || "—";
}

function formatActual(s: ScenarioResult): string {
  const parts: string[] = [s.actual.result];
  if (s.actual.httpStatus !== null) parts.push(`HTTP ${s.actual.httpStatus}`);
  return parts.join(", ");
}

function scenarioFindingsTable(s: ScenarioResult): string {
  const relevantFindings = s.report.findings.filter(
    (f) => f.severity !== "PASS" || s.report.overallStatus === "PASS",
  );
  if (relevantFindings.length === 0) return "";

  const header = "| Severity | Code | Message |\n|---|---|---|";
  const rows = relevantFindings
    .map((f) => `| ${statusBadgeSeverity(f.severity)} | \`${f.code}\` | ${f.message} |`)
    .join("\n");
  return `\n${header}\n${rows}\n`;
}

export function toMarkdownConfig(report: ConfigReport): string {
  const lines: string[] = [];

  lines.push(`## MCP Release Config Report`);
  lines.push("");
  lines.push(`**Server:** \`${report.serverUrl}\``);
  lines.push(`**Config:** \`${report.configFile}\``);
  lines.push(`**Status:** ${statusBadgeSeverity(report.overallStatus)}`);
  if (report.mcpReleaseVersion) {
    lines.push(`**MCP Release:** v${report.mcpReleaseVersion}`);
  }
  lines.push(`**Started at:** ${report.startedAt}`);
  lines.push(`**Duration:** ${report.durationMs}ms`);
  lines.push("");

  const passed = report.scenarios.filter((s) => s.matched).length;
  const total = report.scenarios.length;
  lines.push(`| Passed | Failed |`);
  lines.push(`|---|---|`);
  lines.push(`| ${passed} | ${total - passed} |`);
  lines.push("");

  if (report.executionEnvironment === "cli" || report.executionEnvironment === "github-actions") {
    lines.push(
      `> **Security:** Credentials are sent only to the configured MCP endpoint. They are never sent to or stored by MCP Release.`,
    );
    lines.push(
      `> Scenario execution and report generation run locally in the CLI or GitHub Actions runner.`,
    );
    lines.push("");
  }

  lines.push(`### Scenarios`);
  lines.push("");
  lines.push(`| Scenario | Expected | Actual | Attempts | Retry | Duration | Result |`);
  lines.push(`|---|---|---|---|---|---|---|`);

  for (const s of report.scenarios) {
    const attStr = s.maxAttempts ? `${s.attempts}/${s.maxAttempts}` : `${s.attempts}`;
    const retryStr = s.retryCategory ? s.retryCategory : s.maxAttempts && s.maxAttempts > 1 ? "enabled" : "off";
    lines.push(
      `| \`${s.name}\` | ${formatExpected(s)} | ${formatActual(s)} | ${attStr} | ${retryStr} | ${s.durationMs}ms | ${statusBadge(s.matched)} |`,
    );
  }
  lines.push("");

  for (const s of report.scenarios) {
    if (!s.matched || s.report.findings.some((f) => f.severity === "FAIL" || f.severity === "WARNING")) {
      lines.push(`#### \`${s.name}\``);
      lines.push(scenarioFindingsTable(s));
    }
  }

  return lines.join("\n");
}
