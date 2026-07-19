import { z } from "zod";

export const FindingSeverity = z.enum(["PASS", "WARNING", "FAIL"]);
export type FindingSeverity = z.infer<typeof FindingSeverity>;

export const FindingCode = z.enum([
  // Transport / connectivity
  "TRANSPORT_ERROR",
  "AUTH_REQUIRED",
  "AUTH_INVALID",
  "AUTH_EXPIRED",
  "AUTH_FORBIDDEN",
  "SCENARIO_MISMATCH",
  "REMOTE_HTTP_ERROR",
  "HTTP_ERROR",
  "TIMEOUT",
  "CONNECT_TIMEOUT",
  "RESPONSE_TIMEOUT",
  "SCENARIO_TIMEOUT",
  "RATE_LIMITED",
  "RETRY_AFTER_INVALID",
  "RETRY_EXHAUSTED",
  "REDIRECT_LIMIT_EXCEEDED",
  "REDIRECT_LOOP",
  "PROTOCOL_DOWNGRADE",
  "SSRF_BLOCKED",
  "HTTPS_REQUIRED",
  "EMBEDDED_CREDENTIALS",
  "REQUEST_SIZE_LIMIT",
  // Protocol
  "INIT_FAILURE",
  "PROTOCOL_VERSION_MISMATCH",
  "TOOLS_LIST_FAILURE",
  // Tool structure
  "TOOL_INVALID_NAME",
  "TOOL_MISSING_DESCRIPTION",
  "TOOL_EMPTY_DESCRIPTION",
  "TOOL_INVALID_INPUT_SCHEMA",
  "TOOL_INVALID_OUTPUT_SCHEMA",
  "TOOL_UNSUPPORTED_SCHEMA_DRAFT",
  "TOOL_DUPLICATE_NAME",
  // Success markers
  "INIT_OK",
  "TOOLS_LIST_OK",
  "TOOL_OK",
  // Stdio transport
  "STDIO_UNEXPECTED_OUTPUT",
  "STDIO_FRAMING_ERROR",
  "STDIO_SHUTDOWN_TIMEOUT",
  "STDIO_PROCESS_ERROR",
  "STDIO_RESPONSE_SIZE_EXCEEDED",
]);
export type FindingCode = z.infer<typeof FindingCode>;

export const Finding = z.object({
  code: FindingCode,
  severity: FindingSeverity,
  message: z.string(),
  context: z.record(z.string(), z.unknown()).optional(),
});
export type Finding = z.infer<typeof Finding>;

export const ToolReport = z.object({
  name: z.string(),
  findings: z.array(Finding),
  overallStatus: FindingSeverity,
});
export type ToolReport = z.infer<typeof ToolReport>;

export const TransportMeta = z.object({
  httpStatus: z.number().nullable(),
  httpStatusText: z.string().nullable(),
  durationMs: z.number(),
  redirectCount: z.number(),
  // HTTP metadata may be unavailable depending on SDK transport internals.
  // When null, the reason is recorded in findings.
  headersAvailable: z.boolean(),
});
export type TransportMeta = z.infer<typeof TransportMeta>;

export const CheckReport = z.object({
  schemaVersion: z.literal("1"),
  serverUrl: z.string(),
  checkedAt: z.string(),
  durationMs: z.number(),
  overallStatus: FindingSeverity,
  transport: TransportMeta.nullable(),
  // Added in v0.2.0 — distinguishes http from stdio so reporters can show
  // transport-specific sections without relying on transport === null heuristics.
  transportType: z.enum(["http", "stdio"]).optional(),
  // ISO-8601 timestamp when validation started. Always set in new reports.
  // Old saved reports only have checkedAt; reporters fall back to checkedAt.
  startedAt: z.string().optional(),
  // Set by CLI, GitHub Action, and browser in all new reports.
  mcpReleaseVersion: z.string().optional(),
  // Always set in new reports; optional for backward compatibility with old saved reports.
  executionEnvironment: z.enum(["browser", "cli", "github-actions"]).optional(),
  protocolVersion: z.string().nullable(),
  serverInfo: z
    .object({
      name: z.string().optional(),
      version: z.string().optional(),
    })
    .nullable(),
  findings: z.array(Finding),
  tools: z.array(ToolReport),
  // Added in v0.3.0 — present when this report was produced as part of a named
  // scenario (config-file run). Optional for backward compatibility.
  scenarioName: z.string().optional(),
  // Number of attempts made (>1 when retries occurred). Optional; absent means 1.
  attempts: z.number().int().positive().optional(),
});
export type CheckReport = z.infer<typeof CheckReport>;

const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  PASS: 0,
  WARNING: 1,
  FAIL: 2,
};

export function worstSeverity(findings: Finding[]): FindingSeverity {
  let worst: FindingSeverity = "PASS";
  for (const f of findings) {
    if (SEVERITY_ORDER[f.severity] > SEVERITY_ORDER[worst]) {
      worst = f.severity;
    }
  }
  return worst;
}

export function makeFinding(
  code: FindingCode,
  severity: FindingSeverity,
  message: string,
  context?: Record<string, unknown>,
): Finding {
  return context !== undefined
    ? { code, severity, message, context }
    : { code, severity, message };
}
