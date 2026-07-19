import kleur from "kleur";
import type { CheckReport, Finding } from "@mcp-release/core";

function severityColor(s: string): string {
  if (s === "FAIL") return kleur.red().bold(s);
  if (s === "WARNING") return kleur.yellow().bold(s);
  return kleur.green().bold(s);
}

function printFinding(f: Finding, indent = "  "): string {
  return `${indent}${severityColor(f.severity)} [${f.code}] ${f.message}`;
}

export function toTerminal(report: CheckReport): string {
  const lines: string[] = [];

  const allFindings = [...report.findings, ...report.tools.flatMap((t) => t.findings)];
  const passCount = allFindings.filter((f) => f.severity === "PASS").length;
  const warnCount = allFindings.filter((f) => f.severity === "WARNING").length;
  const failCount = allFindings.filter((f) => f.severity === "FAIL").length;

  const versionSuffix = report.mcpReleaseVersion ? ` v${report.mcpReleaseVersion}` : "";
  lines.push(kleur.bold(`\nMCP Release${versionSuffix} — ${report.serverUrl}`));

  const transportLabel =
    report.transportType === "stdio"
      ? "stdio"
      : report.transportType === "http"
        ? "HTTP/SSE"
        : null;
  if (transportLabel) {
    lines.push(
      `Transport: ${kleur.cyan(transportLabel)}  |  Status: ${severityColor(report.overallStatus)}`,
    );
  } else {
    lines.push(`Status: ${severityColor(report.overallStatus)}`);
  }

  lines.push(
    `Passed: ${passCount}  |  Warnings: ${warnCount}  |  Failures: ${failCount}  |  Duration: ${report.durationMs}ms`,
  );
  lines.push(`Started at: ${report.startedAt ?? report.checkedAt}`);

  if (report.protocolVersion) {
    lines.push(`Protocol: ${report.protocolVersion}`);
  }

  if (report.transportType === "stdio") {
    lines.push(
      kleur.dim("\nCredentials are sent only to the configured MCP endpoint. They are never sent to or stored by MCP Release.\nScenario execution and report generation run locally in the CLI or GitHub Actions runner."),
    );
  }

  if (report.findings.length > 0) {
    lines.push(kleur.bold("\nFindings:"));
    for (const f of report.findings) {
      lines.push(printFinding(f));
    }
  }

  if (report.tools.length > 0) {
    lines.push(kleur.bold(`\nTools (${report.tools.length}):`));
    for (const tool of report.tools) {
      lines.push(`  ${kleur.cyan(tool.name)}  ${severityColor(tool.overallStatus)}`);
      for (const f of tool.findings) {
        lines.push(printFinding(f, "    "));
      }
    }
    if (report.transportType === "stdio") {
      lines.push(kleur.dim("\n  Tools were discovered but not invoked."));
    }
  }

  lines.push("");
  return lines.join("\n");
}
