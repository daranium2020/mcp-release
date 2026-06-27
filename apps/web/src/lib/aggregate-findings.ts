import type { CheckReport, Finding, FindingSeverity } from "@mcp-release/core";

export type FindingCounts = {
  fail: number;
  warn: number;
  pass: number;
};

export type AggregatedFindings = {
  /** Every finding from the report: top-level + all tool-level findings. */
  all: Finding[];
  counts: FindingCounts;
  /**
   * Status derived purely from the aggregated findings.
   * FAIL if any failure exists; WARNING if any warning (and no failure);
   * otherwise PASS. Should always match report.overallStatus for valid reports.
   */
  derivedStatus: FindingSeverity;
};

/**
 * Aggregate findings from every level of a CheckReport.
 *
 * The report model stores findings at two independent levels:
 *   - report.findings: transport and protocol-level findings
 *   - report.tools[].findings: per-tool findings
 *
 * No finding object is shared between these levels, so concatenation
 * produces a complete picture with no double counting.
 */
export function aggregateFindings(report: CheckReport): AggregatedFindings {
  const all: Finding[] = [
    ...report.findings,
    ...report.tools.flatMap((t) => t.findings),
  ];

  const fail = all.filter((f) => f.severity === "FAIL").length;
  const warn = all.filter((f) => f.severity === "WARNING").length;
  const pass = all.filter((f) => f.severity === "PASS").length;

  const derivedStatus: FindingSeverity =
    fail > 0 ? "FAIL" : warn > 0 ? "WARNING" : "PASS";

  return { all, counts: { fail, warn, pass }, derivedStatus };
}
