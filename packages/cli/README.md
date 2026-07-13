# @mcp-release/cli

Release validation CLI for MCP servers. Verifies the protocol handshake, discovers tools, validates their schemas, and checks network configuration. Tools are never invoked.

## Install

```bash
npm install -g @mcp-release/cli
```

Or run without installing:

```bash
npx @mcp-release/cli check https://your-mcp-server.example.com/mcp
```

Requires Node.js >= 20.

## Usage

```bash
# Public endpoint
mcp-release check https://your-mcp-server.example.com/mcp

# JSON output
mcp-release check https://example.com/mcp --json

# Markdown output
mcp-release check https://example.com/mcp --markdown

# Write report to file
mcp-release check https://example.com/mcp --json --out report.json

# Bearer token from environment variable (recommended for secrets)
MCP_TOKEN=your-token mcp-release check https://staging.example.com/mcp --bearer-token-env MCP_TOKEN

# Literal header (for non-secret values only)
mcp-release check https://staging.example.com/mcp --header "X-Tenant-Id: acme"

# Header value from environment variable
MY_KEY=secret mcp-release check https://staging.example.com/mcp --header-env "X-API-Key=MY_KEY"

# Localhost or private network endpoint
mcp-release check http://localhost:4000/mcp --allow-http

# Exit 4 on WARNING (e.g., AUTH_REQUIRED)
MCP_TOKEN=your-token mcp-release check https://staging.example.com/mcp \
  --bearer-token-env MCP_TOKEN --fail-on-warning
```

## Options

| Option | Description |
|---|---|
| `--header "Name: value"` | Add a request header. Repeatable. Use for non-secret values only. |
| `--header-env "Name=VAR"` | Read a header value from an env var. Repeatable. |
| `--bearer-token-env VAR` | Read a bearer token from an env var; sends `Authorization: Bearer <token>`. |
| `--timeout-ms <ms>` | Request timeout in milliseconds (default: 10000). |
| `--max-redirects <n>` | Maximum redirects to follow (default: 3). |
| `--allow-http` | Allow HTTP connections for localhost/development. |
| `--json` | Print JSON report to stdout. |
| `--markdown` | Print Markdown report to stdout. |
| `--out <path>` | Write report to file (JSON by default; Markdown if `--markdown`). |
| `--fail-on-warning` | Exit 4 when overall status is WARNING. |

## Exit codes

| Code | Meaning |
|---|---|
| `0` | PASS |
| `1` | FAIL (validation found a blocking issue) |
| `2` | Invalid CLI usage (bad arguments, missing env var) |
| `3` | Transport error, timeout, or unexpected runtime error |
| `4` | WARNING and `--fail-on-warning` was set |

## What is checked

- MCP initialization handshake and protocol version negotiation
- Tool names, descriptions, and `inputSchema` (valid JSON Schema)
- HTTPS enforcement and SSRF protection (DNS pinning, private IP blocking)
- Redirect chain validation (up to 3 hops by default)

Tools are never invoked. Credentials are never stored.

## Repository

https://github.com/daranium2020/mcp-release
