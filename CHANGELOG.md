# Changelog

All notable changes to this project will be documented in this file.

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
