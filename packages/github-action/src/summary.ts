import * as core from "@actions/core";
import type { CheckReport } from "@mcp-release/core";
import { toMarkdown } from "@mcp-release/reporter";

const STATUS_EMOJI: Record<string, string> = {
  PASS: "✅",
  WARNING: "⚠️",
  FAIL: "❌",
};

export async function writeJobSummary(report: CheckReport): Promise<void> {
  const emoji = STATUS_EMOJI[report.overallStatus] ?? "❓";
  const md = toMarkdown(report);

  await core.summary
    .addHeading(`${emoji} MCP Release — Release Check`, 2)
    .addRaw(`\n${md}\n`)
    .write();
}
