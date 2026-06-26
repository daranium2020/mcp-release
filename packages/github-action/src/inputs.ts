import * as core from "@actions/core";
import { redactUrl } from "@mcp-launch/core";

export type ActionInputs = {
  endpoint: string;
  safeEndpoint: string;
  timeoutMs: number;
  failOn: "WARNING" | "FAIL";
  format: "json" | "markdown" | "both";
  outputDirectory: string;
  developmentMode: boolean;
};

export function parseInputs(): ActionInputs {
  const rawEndpoint = core.getInput("endpoint", { required: true }).trim();
  if (rawEndpoint === "") {
    throw new Error("Input 'endpoint' must not be empty");
  }
  // Validate the URL is parseable before proceeding
  try {
    new URL(rawEndpoint);
  } catch {
    throw new Error(
      `Input 'endpoint' is not a valid URL: ${redactUrl(rawEndpoint)}`,
    );
  }
  const safeEndpoint = redactUrl(rawEndpoint);

  const timeoutRaw = core.getInput("timeout-ms").trim() || "10000";
  const timeoutMs = parseInt(timeoutRaw, 10);
  if (Number.isNaN(timeoutMs) || timeoutMs <= 0 || timeoutMs > 300_000) {
    throw new Error(
      `Input 'timeout-ms' must be a positive integer ≤ 300000, got: ${timeoutRaw}`,
    );
  }

  const failOnRaw = (core.getInput("fail-on").trim() || "fail").toLowerCase();
  if (failOnRaw !== "warning" && failOnRaw !== "fail") {
    throw new Error(
      `Input 'fail-on' must be "warning" or "fail", got: ${failOnRaw}`,
    );
  }
  const failOn: "WARNING" | "FAIL" = failOnRaw === "warning" ? "WARNING" : "FAIL";

  const formatRaw = (core.getInput("format").trim() || "markdown").toLowerCase();
  if (formatRaw !== "json" && formatRaw !== "markdown" && formatRaw !== "both") {
    throw new Error(
      `Input 'format' must be "json", "markdown", or "both", got: ${formatRaw}`,
    );
  }
  const format = formatRaw as "json" | "markdown" | "both";

  const outputDirectory = core.getInput("output-directory").trim();

  const devRaw = core.getInput("development-mode").trim().toLowerCase();
  const developmentMode = devRaw === "true";

  return {
    endpoint: rawEndpoint,
    safeEndpoint,
    timeoutMs,
    failOn,
    format,
    outputDirectory,
    developmentMode,
  };
}
