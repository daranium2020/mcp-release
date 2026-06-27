import { program } from "commander";
import { runCheck } from "@mcp-release/core";
import { toJson, toMarkdown, toTerminal } from "@mcp-release/reporter";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "../package.json"), "utf8"),
) as { version: string };

program
  .name("mcp-release")
  .description("Release validation checker for remote MCP servers")
  .version(pkg.version);

program
  .command("check <url>")
  .description("Check a remote MCP server and produce a validation report")
  .option(
    "--timeout <ms>",
    "Request timeout in milliseconds",
    (v) => parseInt(v, 10),
    10000,
  )
  .option(
    "--max-redirects <n>",
    "Maximum number of redirects to follow",
    (v) => parseInt(v, 10),
    3,
  )
  .option(
    "--env <env>",
    "Environment (production | development | test). HTTP only allowed in development/test",
    "production",
  )
  .option(
    "--output <format>",
    "Output format: json | markdown | terminal",
    "terminal",
  )
  .option(
    "--fail-on <severity>",
    "Exit with code 1 if overall status is at or above this severity (WARNING | FAIL)",
    "FAIL",
  )
  .action(
    async (
      url: string,
      options: {
        timeout: number;
        maxRedirects: number;
        env: string;
        output: string;
        failOn: string;
      },
    ) => {
      const allowHttp =
        options.env === "development" || options.env === "test";

      let report;
      try {
        report = await runCheck(url, {
          timeoutMs: options.timeout,
          maxRedirects: options.maxRedirects,
          allowHttp,
        });
      } catch (err) {
        process.stderr.write(
          `Fatal error running check: ${String(err)}\n`,
        );
        process.exit(2);
      }

      const format = options.output.toLowerCase();
      if (format === "json") {
        process.stdout.write(toJson(report) + "\n");
      } else if (format === "markdown") {
        process.stdout.write(toMarkdown(report) + "\n");
      } else {
        process.stdout.write(toTerminal(report));
      }

      const failOn = options.failOn.toUpperCase();
      const statusOrder: Record<string, number> = {
        PASS: 0,
        WARNING: 1,
        FAIL: 2,
      };
      const threshold = statusOrder[failOn] ?? 2;
      const actual = statusOrder[report.overallStatus] ?? 0;
      if (actual >= threshold) {
        process.exit(1);
      }
    },
  );

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`Unexpected error: ${String(err)}\n`);
  process.exit(2);
});
