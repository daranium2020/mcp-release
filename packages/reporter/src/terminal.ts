import kleur from "kleur";
import type { CheckReport, Finding } from "@mcp-launch/core";

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

  lines.push(kleur.bold(`\nMCP Launch — ${report.serverUrl}`));
  lines.push(`Status: ${severityColor(report.overallStatus)}`);
  lines.push(`Duration: ${report.durationMs}ms  |  Checked at: ${report.checkedAt}`);
  if (report.protocolVersion) {
    lines.push(`Protocol: ${report.protocolVersion}`);
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
  }

  lines.push("");
  return lines.join("\n");
}
