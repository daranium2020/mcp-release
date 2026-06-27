import { describe, it, expect } from "vitest";
import type { CheckReport } from "@mcp-launch/core";
import { aggregateFindings } from "../../src/lib/aggregate-findings.js";

const BASE: CheckReport = {
  schemaVersion: "1",
  serverUrl: "https://example.com/mcp",
  checkedAt: "2026-01-01T00:00:00.000Z",
  durationMs: 100,
  overallStatus: "PASS",
  transport: null,
  protocolVersion: null,
  serverInfo: null,
  findings: [],
  tools: [],
};

describe("aggregateFindings", () => {
  // ---- Top-level findings ----

  it("counts top-level failures", () => {
    const report: CheckReport = {
      ...BASE,
      overallStatus: "FAIL",
      findings: [
        { code: "INIT_FAILURE", severity: "FAIL", message: "Init failed" },
        { code: "INIT_OK", severity: "PASS", message: "Init ok" },
      ],
    };
    const { counts, derivedStatus } = aggregateFindings(report);
    expect(counts.fail).toBe(1);
    expect(counts.pass).toBe(1);
    expect(counts.warn).toBe(0);
    expect(derivedStatus).toBe("FAIL");
  });

  it("counts top-level warnings", () => {
    const report: CheckReport = {
      ...BASE,
      overallStatus: "WARNING",
      findings: [
        { code: "PROTOCOL_VERSION_MISMATCH", severity: "WARNING", message: "Version mismatch" },
      ],
    };
    const { counts, derivedStatus } = aggregateFindings(report);
    expect(counts.warn).toBe(1);
    expect(counts.fail).toBe(0);
    expect(derivedStatus).toBe("WARNING");
  });

  // ---- Nested tool findings ----

  it("counts nested tool failures", () => {
    const report: CheckReport = {
      ...BASE,
      overallStatus: "FAIL",
      findings: [
        { code: "INIT_OK", severity: "PASS", message: "Init ok" },
        { code: "TOOLS_LIST_OK", severity: "PASS", message: "Tools listed" },
      ],
      tools: [
        {
          name: "bad_tool",
          overallStatus: "FAIL",
          findings: [
            { code: "TOOL_INVALID_NAME", severity: "FAIL", message: "Invalid name" },
          ],
        },
      ],
    };
    const { counts, derivedStatus } = aggregateFindings(report);
    expect(counts.fail).toBe(1);
    expect(counts.pass).toBe(2);
    expect(counts.warn).toBe(0);
    expect(derivedStatus).toBe("FAIL");
  });

  it("counts nested tool warnings", () => {
    const report: CheckReport = {
      ...BASE,
      overallStatus: "WARNING",
      findings: [
        { code: "INIT_OK", severity: "PASS", message: "Init ok" },
        { code: "TOOLS_LIST_OK", severity: "PASS", message: "Tools listed" },
      ],
      tools: [
        {
          name: "warn_tool",
          overallStatus: "WARNING",
          findings: [
            { code: "TOOL_EMPTY_DESCRIPTION", severity: "WARNING", message: "Empty description" },
            { code: "TOOL_OK", severity: "PASS", message: "Name valid" },
          ],
        },
      ],
    };
    const { counts, derivedStatus } = aggregateFindings(report);
    expect(counts.warn).toBe(1);
    expect(counts.pass).toBe(3);
    expect(counts.fail).toBe(0);
    expect(derivedStatus).toBe("WARNING");
  });

  // ---- Mixed levels ----

  it("aggregates mixed top-level and nested findings", () => {
    const report: CheckReport = {
      ...BASE,
      overallStatus: "FAIL",
      findings: [
        { code: "INIT_FAILURE", severity: "FAIL", message: "Init failed" },
        { code: "PROTOCOL_VERSION_MISMATCH", severity: "WARNING", message: "Version mismatch" },
      ],
      tools: [
        {
          name: "tool_a",
          overallStatus: "FAIL",
          findings: [
            { code: "TOOL_INVALID_NAME", severity: "FAIL", message: "Bad name" },
            { code: "TOOL_OK", severity: "PASS", message: "Schema ok" },
          ],
        },
        {
          name: "tool_b",
          overallStatus: "WARNING",
          findings: [
            { code: "TOOL_EMPTY_DESCRIPTION", severity: "WARNING", message: "No desc" },
          ],
        },
      ],
    };
    const { counts, all } = aggregateFindings(report);
    expect(counts.fail).toBe(2);   // top-level FAIL + tool_a FAIL
    expect(counts.warn).toBe(2);   // top-level WARNING + tool_b WARNING
    expect(counts.pass).toBe(1);   // tool_a PASS
    expect(all.length).toBe(5);    // all findings combined
  });

  // ---- No double counting ----

  it("does not double count findings that appear in only one level", () => {
    const report: CheckReport = {
      ...BASE,
      findings: [
        { code: "INIT_OK", severity: "PASS", message: "Init ok" },
      ],
      tools: [
        {
          name: "t",
          overallStatus: "PASS",
          findings: [
            { code: "TOOL_OK", severity: "PASS", message: "Tool ok" },
          ],
        },
      ],
    };
    const { all, counts } = aggregateFindings(report);
    expect(all.length).toBe(2);
    expect(counts.pass).toBe(2);
    expect(counts.fail).toBe(0);
    expect(counts.warn).toBe(0);
  });

  // ---- Derived status ----

  it("derives PASS when all findings pass", () => {
    const report: CheckReport = {
      ...BASE,
      findings: [{ code: "INIT_OK", severity: "PASS", message: "ok" }],
      tools: [
        {
          name: "t",
          overallStatus: "PASS",
          findings: [{ code: "TOOL_OK", severity: "PASS", message: "ok" }],
        },
      ],
    };
    expect(aggregateFindings(report).derivedStatus).toBe("PASS");
  });

  it("derives PASS when there are no findings at all", () => {
    expect(aggregateFindings(BASE).derivedStatus).toBe("PASS");
  });

  it("derives WARNING over PASS", () => {
    const report: CheckReport = {
      ...BASE,
      overallStatus: "WARNING",
      findings: [
        { code: "PROTOCOL_VERSION_MISMATCH", severity: "WARNING", message: "warn" },
        { code: "INIT_OK", severity: "PASS", message: "ok" },
      ],
    };
    expect(aggregateFindings(report).derivedStatus).toBe("WARNING");
  });

  it("derives FAIL over WARNING", () => {
    const report: CheckReport = {
      ...BASE,
      overallStatus: "FAIL",
      findings: [
        { code: "PROTOCOL_VERSION_MISMATCH", severity: "WARNING", message: "warn" },
      ],
      tools: [
        {
          name: "t",
          overallStatus: "FAIL",
          findings: [
            { code: "TOOL_INVALID_NAME", severity: "FAIL", message: "fail" },
          ],
        },
      ],
    };
    expect(aggregateFindings(report).derivedStatus).toBe("FAIL");
  });

  // ---- Multiple tools ----

  it("aggregates findings across all tools", () => {
    const report: CheckReport = {
      ...BASE,
      overallStatus: "FAIL",
      tools: Array.from({ length: 5 }, (_, i) => ({
        name: `tool_${i}`,
        overallStatus: "FAIL" as const,
        findings: [
          { code: "TOOL_INVALID_NAME" as const, severity: "FAIL" as const, message: `fail ${i}` },
        ],
      })),
    };
    const { counts } = aggregateFindings(report);
    expect(counts.fail).toBe(5);
    expect(counts.warn).toBe(0);
    expect(counts.pass).toBe(0);
  });
});
