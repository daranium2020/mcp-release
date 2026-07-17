import type { CheckReport } from "@mcp-release/core";

export function toJson(report: CheckReport, pretty = true): string {
  // For stdio reports, omit the transport field entirely rather than rendering
  // transport: null (HTTP transport fields are not applicable to stdio).
  if (report.transportType === "stdio") {
    const { transport: _omit, ...rest } = report;
    return JSON.stringify(rest, null, pretty ? 2 : 0);
  }
  return JSON.stringify(report, null, pretty ? 2 : 0);
}
