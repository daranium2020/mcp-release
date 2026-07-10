import * as core from "@actions/core";
import { runCheck, redactErrorMessage, type ToolReport } from "@mcp-release/core";
import { toJson, toMarkdown } from "@mcp-release/reporter";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseInputs } from "./inputs.js";
import { emitAnnotations } from "./annotations.js";
import { writeJobSummary } from "./summary.js";

const STATUS_ORDER: Record<string, number> = { PASS: 0, WARNING: 1, FAIL: 2 };

async function main(): Promise<void> {
  const inputs = parseInputs();

  core.info(`Checking MCP server: ${inputs.safeEndpoint}`);
  if (inputs.developmentMode) {
    core.warning("development-mode is enabled - HTTP connections are allowed. Do not use in production.");
  }
  if (Object.keys(inputs.requestHeaders).length > 0) {
    const headerNames = Object.keys(inputs.requestHeaders).join(", ");
    core.info(`Using request headers: ${headerNames} (values masked)`);
  }

  const report = await runCheck(inputs.endpoint, {
    timeoutMs: inputs.timeoutMs,
    allowHttp: inputs.developmentMode,
    ...(Object.keys(inputs.requestHeaders).length > 0
      ? { requestHeaders: inputs.requestHeaders }
      : {}),
  });

  // Count findings
  const allFindings = [
    ...report.findings,
    ...report.tools.flatMap((t: ToolReport) => t.findings),
  ];
  const passCount = allFindings.filter((f) => f.severity === "PASS").length;
  const warnCount = allFindings.filter((f) => f.severity === "WARNING").length;
  const failCount = allFindings.filter((f) => f.severity === "FAIL").length;
  const toolCount = report.tools.length;

  // Set action outputs
  core.setOutput("status", report.overallStatus);
  core.setOutput("failures", String(failCount));
  core.setOutput("warnings", String(warnCount));
  core.setOutput("tools", String(toolCount));
  core.setOutput("pass-count", String(passCount));
  core.setOutput("warning-count", String(warnCount));
  core.setOutput("fail-count", String(failCount));

  // Determine output directory
  const outDir = inputs.outputDirectory !== ""
    ? path.resolve(inputs.outputDirectory)
    : (process.env["RUNNER_TEMP"] ?? "/tmp");

  let singleReportPath: string | undefined;

  // Write report files
  if (inputs.format === "json" || inputs.format === "both") {
    mkdirSync(outDir, { recursive: true });
    const jsonPath = path.join(outDir, "mcp-release-report.json");
    writeFileSync(jsonPath, toJson(report), "utf8");
    core.setOutput("report-json", jsonPath);
    core.info(`JSON report written to: ${jsonPath}`);
    if (inputs.format === "json") singleReportPath = jsonPath;
  }

  if (inputs.format === "markdown" || inputs.format === "both") {
    mkdirSync(outDir, { recursive: true });
    const mdPath = path.join(outDir, "mcp-release-report.md");
    writeFileSync(mdPath, toMarkdown(report), "utf8");
    core.setOutput("report-markdown", mdPath);
    core.info(`Markdown report written to: ${mdPath}`);
    if (inputs.format === "markdown") singleReportPath = mdPath;
  }

  if (singleReportPath !== undefined) {
    core.setOutput("report-path", singleReportPath);
  }

  // GitHub Job Summary
  await writeJobSummary(report);

  // GitHub Annotations for WARNING / FAIL findings
  emitAnnotations(report.findings);
  for (const tool of report.tools) {
    emitAnnotations(tool.findings, tool.name);
  }

  // Determine success/failure
  const threshold = STATUS_ORDER[inputs.failOn] ?? 2;
  const actual = STATUS_ORDER[report.overallStatus] ?? 0;

  if (actual >= threshold) {
    core.setFailed(
      `MCP server validation result: ${report.overallStatus} - see findings above`,
    );
  } else {
    core.info(`MCP server validation result: ${report.overallStatus}`);
  }
}

main().catch((err: unknown) => {
  const msg = redactErrorMessage(err);
  core.setFailed(`Action failed: ${msg}`);
});
