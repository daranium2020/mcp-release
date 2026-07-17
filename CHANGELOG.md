# Changelog

All notable changes to this project will be documented in this file.

## 0.2.1 - 2026-07-17

### Added

- **Transport-aware reports** — every report now includes `transportType` ("http" or "stdio"), `executionEnvironment` ("browser" | "cli" | "github-actions"), `startedAt` (ISO 8601 timestamp), and `mcpReleaseVersion` (the tool version that produced the report). All new fields are optional for backward compatibility with saved reports.
- **Remediation hints** in Markdown and terminal output — each finding code now maps to a plain-English remediation hint explaining how to resolve the issue (`packages/reporter`).
- **Transport-specific report sections** — terminal and Markdown reporters show transport label (HTTP/SSE vs. stdio), started-at time, version, and summary counts table. Stdio reports include a privacy note ("No data was sent to MCP Release") and a tools-not-invoked note.
- **JSON stdio transport omission** — for stdio reports, `toJson()` omits the `transport` key entirely rather than rendering `"transport": null`.
- **`safeCommandLabel` path redaction** — the stdio server URL (`stdio:<name>`) now includes only the basename of the executable (e.g. `node` not `/Users/alice/.nvm/bin/node`), preventing local paths from leaking into reports.
- **`mcpReleaseVersion` in all report types** — the web API handler, CLI, and GitHub Action all inject their own version into the report. Browser reports use `PRODUCT_VERSION` from `apps/web/src/lib/constants.ts`.
- **`executionEnvironment` in all report types** — all four callers (browser handler, CLI HTTP, CLI stdio, GitHub Action) inject the appropriate environment label.
- **43 new reporter tests** covering terminal/Markdown/JSON output for all four execution environments, credential and path redaction, backward compatibility with old reports, and full REMEDIATION map coverage. Total: 87 tests in `packages/reporter`.

### Notes

- This is a report-format enhancement release. No behavior changes to transport, validation logic, or API surface.
- `@mcp-release/cli` is bumped to 0.2.1 and **should be published to npm** with this release.
- The GitHub Action (`daranium2020/mcp-release`) should be tagged `v0.2.1`.

## 0.2.0 - 2026-07-17

### Added

- **Stdio transport validation** — validate MCP servers that communicate over stdin/stdout (local spawned processes).
  - CLI: `mcp-release check --stdio --command "npx -y my-mcp-server"` with optional `--cwd <dir>`.
  - GitHub Action: `transport: stdio` input with `command` and `working-directory` inputs.
  - `packages/core` exports `runStdioCheck(params, opts)` and the `StdioCheckParams` / `StdioCheckOptions` types.
- **New finding codes** (`packages/core`):
  - `STDIO_UNEXPECTED_OUTPUT` (WARNING) — non-JSON lines written to stdout; logs must go to stderr.
  - `STDIO_FRAMING_ERROR` (FAIL) — valid JSON on stdout that is not a valid MCP message.
  - `STDIO_RESPONSE_SIZE_EXCEEDED` (FAIL) — stdout exceeded the configured byte limit.
  - `STDIO_SHUTDOWN_TIMEOUT` (WARNING) — server did not exit after stdin EOF and required SIGKILL.
  - `STDIO_PROCESS_ERROR` (FAIL) — process could not be spawned or exited unexpectedly.
- Safe environment inheritance: spawned processes receive a curated subset of `process.env` (`HOME`, `PATH`, `SHELL`, etc.); secrets must be injected via the workflow `env` block.
- Shell-free command parsing: the command string (`"npx -y my-mcp-server"`) is tokenized locally without invoking a shell.
- Shutdown sequence: stdin EOF → `shutdownTimeoutMs` (default 5 s) → `SIGTERM` → 2 s → `SIGKILL`.
- Stdio fixture servers in `fixtures/servers/src/stdio/` for integration testing.
- 18 new tests in `packages/core/tests/stdio-check.test.ts` covering all stdio finding codes.

### Notes

- The web checker at https://mcprelease.dev validates remote HTTP/SSE endpoints only. Stdio validation requires the CLI or GitHub Action.
- `@mcp-release/cli` is bumped to 0.2.0 and **should be published to npm** with this release.
- The GitHub Action (`daranium2020/mcp-release`) should be tagged `v0.2.0`.

## 0.1.2 - 2026-07-15

### Fixed

- GitHub Action runtime updated to `node24`. GitHub Actions runners now use Node.js 24 by default and emit a warning when the action declares `node20`.
- Removed `"type": "module"` from `packages/github-action/package.json`. The presence of that field caused Node.js to treat the CJS bundle (`dist/index.js`) as ESM, producing `ReferenceError: require is not defined in ES module scope` at runtime.

### Notes

- No new npm package is published for this release. `@mcp-release/cli` remains at 0.1.0 (CLI logic is unchanged).

## 0.1.1 - 2026-07-14

### Added

- Root `action.yml` so the GitHub Action is accessible via `uses: daranium2020/mcp-release@v0.1.1`. The action implementation was complete in 0.1.0 but could not be loaded by GitHub without a manifest at the repository root.

### Notes

- No new npm package is published for this release. `@mcp-release/cli` remains at 0.1.0 (CLI logic is unchanged).

## 0.1.0 - 2026-07-14

### Added

- Public web checker for public HTTPS MCP endpoints (https://mcprelease.dev).
- CLI (`@mcp-release/cli`) for validation of public, private, staging, localhost, and authenticated MCP endpoints.
- GitHub Action for CI validation with secrets passed through environment variables.
- JSON and Markdown report output formats.
- Demo MCP fixture endpoint (https://mcp-release-fixture.vercel.app/mcp).
- Documentation for private and authenticated server usage.

### Security

- Web checker does not accept credentials or arbitrary request headers.
- CLI and GitHub Action keep credentials in the user's local environment or CI secrets; credentials are never stored.
- Sensitive headers (`Authorization`, `Cookie`, `X-API-Key`, and others) are redacted from logs, summaries, outputs, and reports.
- Credentials are not forwarded on cross-origin redirects.
- Discovered tools are listed but never executed.

### Notes

- The npm package (`@mcp-release/cli`) is prepared for publication but not published by this PR.
- The GitHub Action can be used from a repository tag after release tagging (`daranium2020/mcp-release@v0.1.0`).
