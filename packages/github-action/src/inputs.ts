import * as core from "@actions/core";
import { redactUrl, buildRequestHeaders, HeaderValidationError } from "@mcp-release/core";

export type ActionInputs = {
  transport: "http" | "stdio";
  // HTTP transport
  endpoint: string;
  safeEndpoint: string;
  requestHeaders: Record<string, string>;
  developmentMode: boolean;
  // Stdio transport
  command: string;
  workingDirectory: string;
  // Common
  timeoutMs: number;
  failOn: "WARNING" | "FAIL";
  format: "json" | "markdown" | "both";
  outputDirectory: string;
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
  const transportRaw = (core.getInput("transport").trim() || "http").toLowerCase();
  if (transportRaw !== "http" && transportRaw !== "stdio") {
    throw new Error(
      `Input 'transport' must be "http" or "stdio", got: ${transportRaw}`,
    );
  }
  const transport = transportRaw as "http" | "stdio";

  // ── Stdio transport inputs ───────────────────────────────────────────────
  const command = core.getInput("command").trim();
  const workingDirectory = core.getInput("working-directory").trim();

  if (transport === "stdio" && command === "") {
    throw new Error("Input 'command' is required when transport is 'stdio'");
  }

  // ── HTTP transport inputs ────────────────────────────────────────────────
  const rawEndpoint = core.getInput("endpoint").trim();

  if (transport === "http" && rawEndpoint === "") {
    throw new Error("Input 'endpoint' is required when transport is 'http'");
  }

  let safeEndpoint = "";
  if (transport === "http") {
    try {
      new URL(rawEndpoint);
    } catch {
      throw new Error(
        `Input 'endpoint' is not a valid URL: ${redactUrl(rawEndpoint)}`,
      );
    }
    safeEndpoint = redactUrl(rawEndpoint);
  }

  // Auth inputs (HTTP only)
  const bearerTokenEnvName = core.getInput("bearer-token-env").trim() || undefined;
  const headerLines = parseLines(core.getInput("header"));
  const headerEnvLines = parseLines(core.getInput("header-env"));

  if (bearerTokenEnvName !== undefined) {
    const rawToken = process.env[bearerTokenEnvName];
    if (rawToken !== undefined) {
      core.setSecret(rawToken);
    }
  }

  let requestHeaders: Record<string, string> = {};
  if (transport === "http" && (headerLines.length > 0 || headerEnvLines.length > 0 || bearerTokenEnvName !== undefined)) {
    try {
      requestHeaders = buildRequestHeaders(
        headerLines,
        headerEnvLines,
        bearerTokenEnvName,
        process.env as Record<string, string | undefined>,
      );
    } catch (err) {
      if (err instanceof HeaderValidationError) {
        throw new Error(`Auth input error: ${(err as Error).message}`);
      }
      throw err;
    }
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
    transport,
    endpoint: rawEndpoint,
    safeEndpoint,
    requestHeaders,
    developmentMode,
    command,
    workingDirectory,
    timeoutMs,
    failOn,
    format,
    outputDirectory,
  };
}
