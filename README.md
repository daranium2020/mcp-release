# MCP Release

Release validation and CI platform for production Model Context Protocol servers.

## Workspace

| Package | Purpose |
|---|---|
| `packages/core` | Validation engine — SSRF guard, DNS pinning, transport adapter, validator, report model |
| `packages/cli` | Command-line interface |
| `packages/reporter` | JSON, Markdown, and terminal report formatters |
| `packages/github-action` | GitHub Action (`action.yml`) wrapping the core validator |
| `apps/web` | Next.js web interface for browser-based release validation |
| `fixtures/servers` | Localhost fixture MCP servers used in tests |

## Commands

```bash
pnpm install                  # install all workspace dependencies
pnpm typecheck                # TypeScript type check (all packages + web)
pnpm lint                     # ESLint across the workspace
pnpm build                    # build all packages including the web app
pnpm test                     # run all tests (14 files, 172 tests)
```

### Web app development

```bash
cd apps/web
pnpm dev                      # start Next.js dev server on http://localhost:3000
```

### CLI usage

```bash
node packages/cli/dist/index.js check https://your-mcp-server.example.com/mcp
node packages/cli/dist/index.js check https://example.com/mcp --output json
node packages/cli/dist/index.js check https://example.com/mcp --timeout 5000
node packages/cli/dist/index.js check https://example.com/mcp --fail-on WARNING
```

**Exit codes:** `0` = below threshold, `1` = threshold met or exceeded, `2` = fatal error.

---

## Milestone 3 — Web MVP

`apps/web` is a Next.js 15 (App Router) web interface that lets users enter an HTTPS MCP endpoint and receive a formatted release-validation report in the browser.

### Interface

The landing page shows a headline, supporting text, and an endpoint input. After submission, the results area displays:

- Overall PASS / WARNING / FAIL status with severity color coding
- Endpoint hostname (credentials and sensitive query parameters are never shown)
- Protocol version, server name, connection duration, redirect count
- Findings grouped by severity (FAIL → WARNING → PASS)
- Discovered tools with per-tool findings
- Export actions: Copy JSON, Download JSON, Download Markdown
- "Run another check" to reset the form

### Architecture

```
apps/web/src/
├── app/
│   ├── layout.tsx              Server component — HTML shell, metadata
│   ├── page.tsx                Server component — hero section + CheckClient
│   └── api/check/
│       ├── handler.ts          Testable request handler (pure function)
│       └── route.ts            Next.js route entry point
├── components/
│   ├── Header.tsx / .module.css
│   ├── Footer.tsx / .module.css
│   ├── CheckClient.tsx / .module.css   Client component — form + state
│   └── Results.tsx / .module.css       Report display
└── lib/
    ├── constants.ts            Public configuration
    ├── rate-limit.ts           In-memory sliding-window rate limiter
    └── concurrency.ts          In-memory concurrency guard
```

### API contract

`POST /api/check` accepts `application/json`:

```json
{ "endpoint": "https://example.com/mcp", "timeoutMs": 10000 }
```

- `endpoint` — required, HTTPS only, no embedded credentials
- `timeoutMs` — optional, 1000–30000ms (default 10000)
- Unexpected fields are rejected with `400 UNEXPECTED_FIELD`

Returns `200 { "report": CheckReport }` or a JSON error body with `error` and `message` fields.

### Security model

- HTTPS required for all endpoints — HTTP is rejected with `400 HTTPS_REQUIRED`
- Embedded credentials rejected at the API layer (before core validation)
- No user-supplied headers, cookies, or Authorization values are forwarded
- All network requests go through `packages/core` which enforces DNS pinning, SSRF blocking, redirect validation, and TLS verification (`rejectUnauthorized: true`, never false)
- Error messages are passed through `redactErrorMessage` + URL credential stripping before being returned
- No stack traces are ever included in API responses
- Security headers on all responses: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Cache-Control: no-store`
- No CORS headers — same-origin only
- Body size capped at 4 KB

### Abuse controls (in-memory, MVP only)

- **Rate limit**: 10 requests per IP per minute (sliding window)
- **Concurrency**: max 5 simultaneous outbound checks
- Both controls are per-process and reset on restart

> **Production limitation**: in-memory rate limiting and concurrency guards are not shared across horizontally-scaled instances. Replace with a shared store (Redis, Upstash, etc.) before running multiple replicas.

### Tools are never invoked

The web app calls `runCheck()` from `packages/core` with `allowHttp: false`. The core validator connects to the MCP server, performs initialization, and calls `tools/list` — but **never calls any tool**. No tool arguments are constructed or sent. No side effects are triggered on the remote server.

### Current limitations

- Not yet publicly deployed (Milestone 3 is a local production-shaped MVP)
- No authentication, billing, rate limiting shared across instances, or persistent storage
- In-memory rate limiting is per-process only
- No horizontal scaling support without a shared rate-limit store
- x-forwarded-for IP is used for rate limiting without proxy verification (can be spoofed without a trusted proxy layer)

---

## Milestone 2 — Security hardening and GitHub Action

- DNS pinning via undici `Agent` with custom connector — closes TOCTOU gap
- Protocol downgrade detection (HTTPS → HTTP redirect blocked)
- IPv4-mapped hex address blocking
- Redirect loop detection (per-chain visited set)
- Embedded credential detection in endpoint URLs
- GitHub Action (`packages/github-action/action.yml`) with inputs, outputs, annotations, and job summary
- CI workflow (`.github/workflows/ci.yml`) with SHA-pinned third-party actions

## Milestone 1 — Remote MCP Release Checker

Validates protocol behavior, tool names, descriptions, and schemas for a remote MCP server without ever invoking tools.

### What is validated

- MCP initialization handshake
- `tools/list` response
- Tool names (non-empty, valid characters)
- Tool descriptions (present, non-empty)
- `inputSchema` — valid JSON Schema, compilable by Ajv, supported draft
- `outputSchema` — validated if present
- Duplicate tool names
- Connection latency, transport errors

### Security — SSRF protection

All URLs are validated before any network connection:

- HTTPS required in production
- Blocked: RFC 1918 private ranges, loopback, link-local, cloud metadata (169.254.169.254), carrier-grade NAT, multicast, NAT64, documentation ranges, discard prefix
- DNS pinning: pre-resolve → validate IP → connector routes TCP/TLS to the pinned IP
- Redirects re-validated at each hop (max 3)
- Secrets and sensitive headers redacted from all outputs

### Report format

```jsonc
{
  "schemaVersion": "1",
  "serverUrl": "https://example.com/mcp",
  "checkedAt": "2026-06-27T00:00:00.000Z",
  "durationMs": 234,
  "overallStatus": "PASS",
  "transport": { "httpStatus": 200, "durationMs": 120, "redirectCount": 0 },
  "protocolVersion": "1.0.0",
  "serverInfo": { "name": "my-server", "version": "1.0.0" },
  "findings": [
    { "code": "INIT_OK", "severity": "PASS", "message": "MCP initialization succeeded" }
  ],
  "tools": [
    { "name": "my_tool", "overallStatus": "PASS", "findings": [...] }
  ]
}
```
