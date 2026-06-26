# @mcp-launch/github-action

GitHub Action that validates a remote MCP server without invoking any tools.

Connects to the server, runs initialization and `tools/list`, validates tool names/descriptions/schemas, and produces a structured report. No tools are ever called.

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `endpoint` | ✅ | — | MCP server URL (`https://` required in production) |
| `timeout-ms` | ❌ | `10000` | Request timeout in milliseconds (max 300000) |
| `fail-on` | ❌ | `fail` | Severity threshold: `warning` or `fail` |
| `format` | ❌ | `markdown` | Report format: `json`, `markdown`, or `both` |
| `output-directory` | ❌ | `$RUNNER_TEMP` | Directory for report files |
| `development-mode` | ❌ | `false` | Allow HTTP (localhost only, not for production) |

## Outputs

| Output | Description |
|---|---|
| `status` | `PASS`, `WARNING`, or `FAIL` |
| `pass-count` | Number of PASS findings |
| `warning-count` | Number of WARNING findings |
| `fail-count` | Number of FAIL findings |
| `report-json` | Absolute path to the JSON report (if `format` includes `json`) |
| `report-markdown` | Absolute path to the Markdown report (if `format` includes `markdown`) |

## Example workflow

```yaml
name: Validate MCP server

on:
  push:
    branches: [main]
  pull_request:

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Check MCP server
        id: mcp-check
        uses: ./packages/github-action  # or your released tag
        with:
          endpoint: https://your-mcp-server.example.com/mcp
          timeout-ms: '15000'
          fail-on: warning
          format: both

      - name: Print result
        run: |
          echo "Status: ${{ steps.mcp-check.outputs.status }}"
          echo "Pass: ${{ steps.mcp-check.outputs.pass-count }}"
          echo "Warnings: ${{ steps.mcp-check.outputs.warning-count }}"
          echo "Failures: ${{ steps.mcp-check.outputs.fail-count }}"
```

## Security

- Tools are **never invoked** — no side-effects on the server.
- SSRF protection: all URLs are validated against IP blocklists before connection.
- DNS pinning: HTTPS connections are pinned to the pre-validated IP address, preventing DNS rebinding.
- TLS certificate verification is always enforced; `rejectUnauthorized: false` is never set.
- Secrets are redacted from all logs, outputs, and error messages.
- Protocol downgrades (HTTPS → HTTP) are always blocked.

## Building the distribution

```bash
pnpm --filter @mcp-launch/github-action run build
```

The bundled `dist/index.js` must be committed to the repository for the action to work. The CI workflow verifies the bundle is current on every push.
