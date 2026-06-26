# MCP Launch

Release validation and CI platform for production Model Context Protocol servers.

## Milestone 1 — Remote MCP Release Checker

MCP Launch connects to a remote MCP server, performs initialization and tool discovery, validates tool names, descriptions, and schemas, and produces a structured report without ever invoking any tools.

### Workspace

| Package | Purpose |
|---|---|
| `packages/core` | Validation engine — SSRF guard, transport adapter, validator, report model |
| `packages/cli` | Command-line interface |
| `packages/reporter` | JSON, Markdown, and terminal report formatters |
| `packages/github-action` | Placeholder — Milestone 2 |
| `apps/web` | Placeholder — Milestone 3+ |
| `fixtures/servers` | Localhost fixture MCP servers used in tests |

### Commands

**Install dependencies**

```bash
pnpm install
```

**Build all packages**

```bash
pnpm -r run build
```

**Type checking**

```bash
pnpm -r run typecheck
```

**Run all tests**

```bash
pnpm test
```

**CLI usage**

```bash
# Check a production HTTPS server
node packages/cli/dist/index.js check https://your-mcp-server.example.com/mcp

# Check a local development server (HTTP allowed in dev/test)
node packages/cli/dist/index.js check http://localhost:3000/mcp --env development

# Output formats: terminal (default), json, markdown
node packages/cli/dist/index.js check https://example.com/mcp --output json

# Custom timeout (milliseconds)
node packages/cli/dist/index.js check https://example.com/mcp --timeout 5000

# Fail on WARNING or worse (default: FAIL)
node packages/cli/dist/index.js check https://example.com/mcp --fail-on WARNING
```

**Exit codes**

| Code | Meaning |
|---|---|
| `0` | Overall status is below the `--fail-on` threshold |
| `1` | Overall status meets or exceeds the `--fail-on` threshold |
| `2` | Fatal error (network, arguments, unexpected crash) |

### What is validated

- MCP initialization handshake (`initialize` request)
- `tools/list` response
- Tool names (non-empty, safe characters only)
- Tool descriptions (present, non-empty)
- `inputSchema` — valid JSON Schema, compilable by Ajv, supported draft
- `outputSchema` — validated if present
- Duplicate tool names
- Connection latency
- Transport and protocol errors

### What is NOT done (by design)

Tools are never invoked. No tool arguments are sent, no side effects are triggered.

### Security — SSRF protection

All URLs are validated before any network connection is made:

- HTTPS required in production (`--env production`, the default)
- HTTP allowed only for `localhost` / `127.0.0.1` in `--env development` or `--env test`
- All A/AAAA records are resolved before connecting; any blocked address rejects the check
- Blocked ranges: loopback, RFC 1918 private, link-local (169.254.x.x), carrier-grade NAT (100.64.0.0/10), multicast, cloud metadata endpoints (169.254.169.254, fd00:ec2::254)
- Redirects are re-validated (max 3 hops)
- Authorization and secret headers are redacted from logs and reports

**Security limitation — DNS pinning (tracked for Milestone 2):**
The MCP SDK's `StreamableHTTPClientTransport` does not support connecting to a pre-resolved IP while preserving the original hostname for TLS/SNI. A TOCTOU window therefore exists between our preflight DNS validation and the SDK's own DNS resolution. Mitigations in place: all resolved addresses are checked before connection, redirect destinations are re-validated, and short timeouts limit the exploitation window. Full DNS pinning is the next security task.

### Report format

```jsonc
{
  "schemaVersion": "1",
  "serverUrl": "https://example.com/mcp",
  "checkedAt": "2026-06-26T12:00:00.000Z",
  "durationMs": 234,
  "overallStatus": "PASS",   // "PASS" | "WARNING" | "FAIL"
  "transport": {
    "httpStatus": null,       // null when SDK doesn't expose it
    "durationMs": 120,
    "redirectCount": 0,
    "headersAvailable": false
  },
  "protocolVersion": "2024-11-05",
  "serverInfo": { "name": "my-server", "version": "1.0.0" },
  "findings": [
    { "code": "INIT_OK", "severity": "PASS", "message": "..." }
  ],
  "tools": [
    {
      "name": "my_tool",
      "overallStatus": "PASS",
      "findings": [
        { "code": "TOOL_OK", "severity": "PASS", "message": "..." }
      ]
    }
  ]
}
```

### Next milestone recommendations

1. DNS pinning — connect to pre-resolved IP, set SNI from original hostname
2. GitHub Action — wrap CLI in an `action.yml` with `url`, `timeout`, `fail-on` inputs
3. Protocol version validation — warn on unexpected protocol versions
4. Response size streaming limits — cap SSE body reads
5. Structured test coverage for `outputSchema` happy path when SDK exposes it
