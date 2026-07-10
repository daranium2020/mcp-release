import * as core from "@actions/core";
import { redactUrl, buildRequestHeaders, HeaderValidationError } from "@mcp-release/core";

export type ActionInputs = {
  endpoint: string;
  safeEndpoint: string;
  requestHeaders: Record<string, string>;
  timeoutMs: number;
  failOn: "WARNING" | "FAIL";
  format: "json" | "markdown" | "both";
  outputDirectory: string;
  developmentMode: boolean;
};

/**
 * Parse newline-separated values from a multi-line action input.
 * Blank lines and lines containing only whitespace are ignored.
 */
function parseLines(raw: string): string[] {
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export function parseInputs(): ActionInputs {
  const rawEndpoint = core.getInput("endpoint", { required: true }).trim();
  if (rawEndpoint === "") {
    throw new Error("Input 'endpoint' must not be empty");
  }
  try {
    new URL(rawEndpoint);
  } catch {
    throw new Error(
      `Input 'endpoint' is not a valid URL: ${redactUrl(rawEndpoint)}`,
    );
  }
  const safeEndpoint = redactUrl(rawEndpoint);

  // Auth inputs
  const bearerTokenEnvName = core.getInput("bearer-token-env").trim() || undefined;
  const headerLines = parseLines(core.getInput("header"));
  const headerEnvLines = parseLines(core.getInput("header-env"));

  // Mask raw bearer token before building headers (raw token is the secret, not "Bearer <token>")
  if (bearerTokenEnvName !== undefined) {
    const rawToken = process.env[bearerTokenEnvName];
    if (rawToken !== undefined) {
      core.setSecret(rawToken);
    }
  }

  let requestHeaders: Record<string, string> = {};
  if (headerLines.length > 0 || headerEnvLines.length > 0 || bearerTokenEnvName !== undefined) {
    try {
      requestHeaders = buildRequestHeaders(
        headerLines,
        headerEnvLines,
        bearerTokenEnvName,
        process.env as Record<string, string | undefined>,
      );
    } catch (err) {
      if (err instanceof HeaderValidationError) {
        throw new Error(`Auth input error: ${err.message}`);
      }
      throw err;
    }
    // Mask sensitive header values in GitHub Actions logs
    for (const [name, value] of Object.entries(requestHeaders)) {
      const lower = name.toLowerCase();
      if (
        lower === "authorization" ||
        lower === "x-api-key" ||
        lower === "cookie" ||
        lower === "x-auth-token" ||
        lower === "proxy-authorization" ||
        lower === "x-secret" ||
        lower === "x-token"
      ) {
        core.setSecret(value);
        // Also mask the bare token for "Bearer <token>" values so the token
        // alone cannot appear in logs even without the "Bearer " prefix.
        if (lower === "authorization" && value.startsWith("Bearer ")) {
          core.setSecret(value.slice("Bearer ".length));
        }
      }
    }
  }

  const timeoutRaw = core.getInput("timeout-ms").trim() || "10000";
  const timeoutMs = parseInt(timeoutRaw, 10);
  if (Number.isNaN(timeoutMs) || timeoutMs <= 0 || timeoutMs > 300_000) {
    throw new Error(
      `Input 'timeout-ms' must be a positive integer <=300000, got: ${timeoutRaw}`,
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
    requestHeaders,
    timeoutMs,
    failOn,
    format,
    outputDirectory,
    developmentMode,
  };
}
