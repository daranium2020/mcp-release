import type { ConfigReport } from "@mcp-release/core";

export function toJsonConfig(report: ConfigReport, pretty = true): string {
  return JSON.stringify(report, null, pretty ? 2 : 0);
}
