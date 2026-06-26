import { z } from "zod";

export const FindingSeverity = z.enum(["PASS", "WARNING", "FAIL"]);
export type FindingSeverity = z.infer<typeof FindingSeverity>;

export const FindingCode = z.enum([
  // Transport / connectivity
  "TRANSPORT_ERROR",
  "HTTP_ERROR",
  "TIMEOUT",
  "REDIRECT_LIMIT_EXCEEDED",
  "SSRF_BLOCKED",
  "HTTPS_REQUIRED",
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
  protocolVersion: z.string().nullable(),
  serverInfo: z
    .object({
      name: z.string().optional(),
      version: z.string().optional(),
    })
    .nullable(),
  findings: z.array(Finding),
  tools: z.array(ToolReport),
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
