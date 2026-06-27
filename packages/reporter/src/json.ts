import type { CheckReport } from "@mcp-release/core";

export function toJson(report: CheckReport, pretty = true): string {
  return JSON.stringify(report, null, pretty ? 2 : 0);
}
