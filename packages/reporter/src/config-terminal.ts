import kleur from "kleur";
import type { ConfigReport, ScenarioResult } from "@mcp-release/core";
import type { FindingSeverity } from "@mcp-release/core";

function statusColor(s: FindingSeverity | "PASS" | "WARNING" | "FAIL"): string {
  if (s === "FAIL") return kleur.red().bold(s);
  if (s === "WARNING") return kleur.yellow().bold(s);
  return kleur.green().bold(s);
}

function scenarioStatusIcon(matched: boolean, status: FindingSeverity): string {
  if (matched) return kleur.green("✓");
  if (status === "WARNING") return kleur.yellow("⚠");
  return kleur.red("✗");
}

function formatScenario(s: ScenarioResult): string {
  const icon = scenarioStatusIcon(s.matched, s.report.overallStatus);
  const name = s.name.padEnd(28);
  const effectiveStatus = s.matched ? "PASS" : "FAIL";
  const badge = statusColor(effectiveStatus as FindingSeverity);

  const parts: string[] = [];

  if (s.expected.httpStatus !== undefined) {
    const got = s.actual.httpStatus !== null ? `HTTP ${s.actual.httpStatus}` : "no status";
    const expected = `HTTP ${s.expected.httpStatus}`;
    parts.push(`expected ${expected}, got ${got}`);
  } else if (s.expected.result !== undefined) {
    parts.push(`expected ${s.expected.result.toUpperCase()}, got ${s.actual.result}`);
  }

  if (s.attempts > 1) {
    const attStr = s.maxAttempts ? `${s.attempts}/${s.maxAttempts}` : `${s.attempts}`;
    const catStr = s.retryCategory ? `, ${s.retryCategory} retry` : "";
    parts.push(`${attStr} attempts${catStr}`);
  }
  parts.push(`${s.durationMs}ms`);

  const detail = parts.length > 0 ? kleur.dim(`(${parts.join(", ")})`) : "";
  return `  ${icon} ${name} ${badge}  ${detail}`;
}

export function toTerminalConfig(report: ConfigReport): string {
  const lines: string[] = [];

  const versionSuffix = report.mcpReleaseVersion ? ` v${report.mcpReleaseVersion}` : "";
  lines.push(kleur.bold(`\nMCP Release${versionSuffix} — ${report.serverUrl}`));
  lines.push(kleur.dim(`Config: ${report.configFile}`));

  lines.push("");

  for (const s of report.scenarios) {
    lines.push(formatScenario(s));

    // Show FAIL findings for non-matching or failed scenarios
    if (!s.matched || s.report.overallStatus === "FAIL") {
      const failFindings = s.report.findings.filter((f) => f.severity === "FAIL" || f.code === "SCENARIO_MISMATCH");
      for (const f of failFindings) {
        lines.push(kleur.dim(`      [${f.code}] ${f.message}`));
      }
    }
  }

  lines.push("");
  const passed = report.scenarios.filter((s) => s.matched).length;
  const total = report.scenarios.length;
  const overallBadge = statusColor(report.overallStatus);
  lines.push(
    `  Overall: ${overallBadge}  |  ${passed}/${total} scenarios passed  |  Total: ${report.durationMs}ms`,
  );
  lines.push(`  Started at: ${report.startedAt}`);

  if (report.executionEnvironment === "cli" || report.executionEnvironment === "github-actions") {
    lines.push(kleur.dim("\n  Credentials are sent only to the configured MCP endpoint. They are never sent to or stored by MCP Release."));
    lines.push(kleur.dim("  Scenario execution and report generation run locally in the CLI or GitHub Actions runner."));
  }

  lines.push("");
  return lines.join("\n");
}
