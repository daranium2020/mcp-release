import type { CheckReport } from "@mcp-release/core";

export type CheckRequest = {
  endpoint: string;
  timeoutMs?: number;
};

export type CheckSuccessResponse = {
  report: CheckReport;
};

export type CheckErrorResponse = {
  error: string;
  message: string;
};

export type CheckApiResponse = CheckSuccessResponse | CheckErrorResponse;

export function isCheckError(r: CheckApiResponse): r is CheckErrorResponse {
  return "error" in r;
}
