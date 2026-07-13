import { program } from "commander";
import {
  runCheck,
  buildRequestHeaders,
  HeaderValidationError,
} from "@mcp-release/core";
import { toJson, toMarkdown, toTerminal } from "@mcp-release/reporter";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname as pathDirname } from "node:path";

// Injected at build time by tsup define — avoids import.meta.url in CJS bundle
declare const __CLI_VERSION__: string;

/**
 * Exit codes:
 *   0  Validation completed — overall status is PASS
 *   1  Validation completed — overall status is FAIL
 *   2  Invalid CLI usage (bad arguments, invalid headers, missing required flags)
 *   3  Transport error, timeout, unreachable endpoint, or unexpected runtime error
 *   4  Validation completed — overall status is WARNING and --fail-on-warning is set
 */

program
  .name("mcp-release")
  .description("Release validation checker for MCP servers")
  .version(__CLI_VERSION__);

type CheckOptions = {
  header: string[];
  headerEnv: string[];
  bearerTokenEnv?: string;
  timeoutMs: number;
  maxRedirects: number;
  allowHttp: boolean;
  json: boolean;
  markdown: boolean;
  out?: string;
  failOnWarning: boolean;
};

program
  .command("check <url>")
  .description("Validate an MCP server and produce a report")
  .option(
    "--header <header>",
    'Add a request header as "Name: value". Can be repeated.',
    (val: string, prev: string[]) => [...prev, val],
    [] as string[],
  )
  .option(
    "--header-env <pair>",
    'Read a header value from an env var as "Name=ENV_VAR". Can be repeated.',
    (val: string, prev: string[]) => [...prev, val],
    [] as string[],
  )
  .option(
    "--bearer-token-env <var>",
    "Read a bearer token from this environment variable and add Authorization: Bearer <token>",
  )
  .option(
    "--timeout-ms <ms>",
    "Request timeout in milliseconds",
    (v: string) => {
      const n = parseInt(v, 10);
      if (Number.isNaN(n) || n <= 0) {
        process.stderr.write(`Error: --timeout-ms must be a positive integer, got: ${v}\n`);
        process.exit(2);
      }
      return n;
    },
    10_000,
  )
  .option(
    "--max-redirects <n>",
    "Maximum redirects to follow",
    (v: string) => parseInt(v, 10),
    3,
  )
  .option(
    "--allow-http",
    "Allow HTTP connections. Use for localhost in development/test only.",
    false,
  )
  .option("--json", "Print JSON report to stdout", false)
  .option("--markdown", "Print Markdown report to stdout", false)
  .option(
    "--out <path>",
    "Write report to a file (JSON by default; Markdown if --markdown is set)",
  )
  .option(
    "--fail-on-warning",
    "Exit with code 4 when the overall status is WARNING",
    false,
  )
  .action(async (url: string, options: CheckOptions) => {
    // Build request headers from all auth flags
    let requestHeaders: Record<string, string> | undefined;
    if (
      options.header.length > 0 ||
      options.headerEnv.length > 0 ||
      options.bearerTokenEnv !== undefined
    ) {
      try {
        requestHeaders = buildRequestHeaders(
          options.header,
          options.headerEnv,
          options.bearerTokenEnv,
          process.env as Record<string, string | undefined>,
        );
      } catch (err) {
        const msg = err instanceof HeaderValidationError ? err.message : String(err);
        process.stderr.write(`Error: ${msg}\n`);
        process.exit(2);
      }
    }

    let report;
    try {
      report = await runCheck(url, {
        timeoutMs: options.timeoutMs,
        maxRedirects: options.maxRedirects,
        allowHttp: options.allowHttp,
        allowPrivateNetworks: true, // CLI always allows private/internal networks
        ...(requestHeaders !== undefined ? { requestHeaders } : {}),
      });
    } catch (err) {
      process.stderr.write(
        `Error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(3);
    }

    // Stdout output (pick first matching mode; terminal is default)
    if (options.json) {
      process.stdout.write(toJson(report) + "\n");
    } else if (options.markdown) {
      process.stdout.write(toMarkdown(report) + "\n");
    } else {
      process.stdout.write(toTerminal(report));
    }

    // File output (independent of stdout mode)
    if (options.out) {
      const content =
        options.markdown && !options.json ? toMarkdown(report) : toJson(report);
      try {
        const outPath = resolve(options.out);
        mkdirSync(pathDirname(outPath), { recursive: true });
        writeFileSync(outPath, content, "utf8");
        // Announce the path in terminal mode only (JSON/Markdown modes produce structured output)
        if (!options.json && !options.markdown) {
          process.stdout.write(`Report written to: ${outPath}\n`);
        }
      } catch (err) {
        process.stderr.write(
          `Error writing report: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exit(3);
      }
    }

    // Exit code
    const { overallStatus } = report;
    if (overallStatus === "FAIL") process.exit(1);
    if (overallStatus === "WARNING" && options.failOnWarning) process.exit(4);
    process.exit(0);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(
    `Unexpected error: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(3);
});
