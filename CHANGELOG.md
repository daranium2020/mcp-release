# Changelog

All notable changes to this project will be documented in this file.

## 0.1.1 - 2026-07-14

### Added

- Root `action.yml` so the GitHub Action is accessible via `uses: daranium2020/mcp-release@v0.1.1`. The action implementation was complete in 0.1.0 but could not be loaded by GitHub without a manifest at the repository root.

### Fixed

- npm bin entry (`dist/index.js` without leading `./`) to prevent npm's normalizer from emitting a spurious "script name was invalid and removed" warning during publish. The CLI binary works correctly in both versions; this removes the warning.

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
