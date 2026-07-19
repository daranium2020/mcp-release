import { z } from "zod";
import { FindingSeverity, CheckReport } from "./report.js";

export const ScenarioExpectation = z.object({
  result: z.enum(["pass", "warning", "fail"]).optional(),
  httpStatus: z.number().int().optional(),
});
export type ScenarioExpectation = z.infer<typeof ScenarioExpectation>;

export const ScenarioActual = z.object({
  result: FindingSeverity,
  httpStatus: z.number().nullable(),
});
export type ScenarioActual = z.infer<typeof ScenarioActual>;

export const ScenarioResult = z.object({
  name: z.string(),
  expected: ScenarioExpectation,
  actual: ScenarioActual,
  matched: z.boolean(),
  attempts: z.number().int().positive(),
  maxAttempts: z.number().int().positive().optional(),
  retryCategory: z.string().nullable().optional(),
  durationMs: z.number(),
  report: CheckReport,
});
export type ScenarioResult = z.infer<typeof ScenarioResult>;

export const ConfigReport = z.object({
  schemaVersion: z.literal("1"),
  configFile: z.string(),
  serverUrl: z.string(),
  startedAt: z.string(),
  durationMs: z.number(),
  overallStatus: FindingSeverity,
  mcpReleaseVersion: z.string().optional(),
  executionEnvironment: z.enum(["browser", "cli", "github-actions"]).optional(),
  scenarios: z.array(ScenarioResult),
});
export type ConfigReport = z.infer<typeof ConfigReport>;
