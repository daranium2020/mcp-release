# MCP Release

MCP Release checks a remote MCP server. It verifies the protocol handshake, discovers tools, validates their schemas, and checks network configuration. It does not execute tools or accept credentials.

**Web app:** https://mcprelease.dev
**Demo endpoint:** https://mcp-release-fixture.vercel.app/mcp
**Repository:** https://github.com/daranium2020/mcp-release

---

## Quick start

### Browser

The web checker at https://mcprelease.dev supports **public HTTPS endpoints only**. It does not accept credentials and cannot reach private networks or localhost.

1. Open https://mcprelease.dev
2. Enter a public HTTPS MCP endpoint URL and click **Run Release Check**
3. Review the report. Download it as JSON or Markdown if needed.

To try without a real server, paste `https://mcp-release-fixture.vercel.app/mcp` directly.

### CLI

The CLI runs on your machine and supports public, private, localhost, and authenticated MCP endpoints. Credentials stay in your environment and are never stored.

The web checker at https://mcprelease.dev only accepts public HTTPS endpoints without credentials. Use the CLI or GitHub Action for private networks, localhost, staging servers, or any endpoint that requires authentication.

```bash
# Install globally (once published to npm)
npm install -g @mcp-release/cli

# Or run directly without installing
npx @mcp-release/cli check https://your-mcp-server.example.com/mcp
```

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

**From this repo (without installing):**

```bash
pnpm build
node packages/cli/dist/index.js check https://mcp-release-fixture.vercel.app/mcp
```

**CLI exit codes:**

| Code | Meaning |
|---|---|
| `0` | PASS |
| `1` | FAIL (validation found a blocking issue) |
| `2` | Invalid CLI usage (bad arguments, missing env var) |
| `3` | Transport error, timeout, or unexpected runtime error |
| `4` | WARNING and `--fail-on-warning` was set |

**All CLI options for `check`:**

| Option | Description |
|---|---|
| `--header "Name: value"` | Add a request header. Repeatable. |
| `--header-env "Name=VAR"` | Read a header value from an env var. Repeatable. |
| `--bearer-token-env VAR` | Read a bearer token from an env var; sends `Authorization: Bearer <token>`. |
| `--timeout-ms <ms>` | Request timeout in milliseconds (default: 10000). |
| `--max-redirects <n>` | Maximum redirects to follow (default: 3). |
| `--allow-http` | Allow HTTP connections for localhost/development. |
| `--json` | Print JSON report to stdout. |
| `--markdown` | Print Markdown report to stdout. |
| `--out <path>` | Write report to file (JSON by default; Markdown if `--markdown`). |
| `--fail-on-warning` | Exit 4 when overall status is WARNING. |

### GitHub Action

The GitHub Action supports public, staging, and authenticated MCP endpoints. Secrets stay in GitHub Actions secrets and are masked in logs.

Reference by a tagged release once published, or by commit SHA for pinned usage:

```yaml
- name: Validate MCP server
  uses: daranium2020/mcp-release@v0.1.0
  with:
    endpoint: https://staging.example.com/mcp
    bearer-token-env: MCP_TOKEN   # reads token from env; never put secrets inline
    fail-on: fail                 # optional: fail (default) | warning
    timeout-ms: 10000             # optional
    format: markdown              # optional: json | markdown | both
  env:
    MCP_TOKEN: ${{ secrets.MCP_TOKEN }}
```

Pass all secrets through the `env` block using GitHub Actions secrets (`${{ secrets.YOUR_SECRET }}`). Never put secret values directly in `with:` inputs or workflow YAML.

**Auth inputs:**

| Input | Description |
|---|---|
| `bearer-token-env` | Name of an env var containing a bearer token. Sends `Authorization: Bearer <token>`. |
| `header` | Newline-separated `Name: value` pairs added to every request. |
| `header-env` | Newline-separated `Name=ENV_VAR` pairs. Values read from environment. |

**Outputs:** `status`, `failures`, `warnings`, `tools`, `report-path`, `pass-count`, `warning-count`, `fail-count`, `report-json`, `report-markdown`

The action annotates the workflow job with findings and writes a summary to the GitHub Actions job summary.

---

## What is checked

| Area | Details |
|---|---|
| **Protocol** | MCP initialization handshake, protocol version negotiation, transport response codes |
| **Tool schemas** | Tool names (non-empty, valid characters), descriptions, `inputSchema` (valid JSON Schema, Ajv-compilable), `outputSchema` (if present), duplicate names |
| **Network safety** | SSRF protection, DNS pinning, redirect chain validation (up to 3 hops), HTTPS enforcement across all redirects |
| **Reports** | Findings exportable as JSON or Markdown |

**What is not checked:** tools are never invoked, authenticated endpoints are not validated, runtime correctness of tool responses is not assessed.

---

## Result meanings

| Result | Meaning |
|---|---|
| **PASS** | All checks completed without a blocking or incomplete condition. A PASS does not guarantee universal security or correctness. It reflects the checks MCP Release ran. |
| **WARNING** | One or more checks could not complete or found a non-blocking issue. If the server returns `401`, MCP Release records `AUTH_REQUIRED` as a WARNING and stops. No credentials are accepted or stored. |
| **FAIL** | One or more checks found a blocking condition. Review the server before shipping. |

---

## Security model

- Tools are discovered via `tools/list` but **never invoked**. No arguments are constructed or sent.
- Only public **HTTPS** endpoints are accepted. HTTP is rejected before any connection.
- Private, loopback, link-local (`169.254.0.0/16`), and cloud-metadata (`169.254.169.254`) destinations are **blocked at the DNS level**.
- **DNS pinning** closes the TOCTOU gap. The resolved IP is pinned at connection time.
- Redirects are re-validated at each hop. HTTPS applies across all redirects.
- Remote response bodies are never included in findings.
- **No credentials** are accepted, forwarded, or stored.
- TLS verification is enforced (`rejectUnauthorized: true`).
- Error messages are redacted. Token patterns and embedded URL credentials are stripped before being returned.

---

## Report formats

### JSON (`schemaVersion: "1"`)

```jsonc
{
  "schemaVersion": "1",
  "serverUrl": "https://example.com/mcp",
  "checkedAt": "2026-06-28T00:00:00.000Z",
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

### Markdown

Human-readable summary suitable for pull request descriptions and release notes. Generated by `packages/reporter`.

### Browser UI

After a check completes, the results area displays overall status, findings grouped by severity, discovered tools, and export buttons (Copy JSON, Download JSON, Download Markdown).

---

## Workspace

| Package / App | Purpose |
|---|---|
| `packages/core` | Validation engine: SSRF guard, DNS pinning, transport adapter, MCP validator, report model |
| `packages/cli` | Command-line interface |
| `packages/reporter` | JSON, Markdown, and terminal report formatters |
| `packages/github-action` | GitHub Action (`action.yml`) wrapping the core validator |
| `apps/web` | Next.js 15 web interface (https://mcprelease.dev) |
| `apps/public-mcp-fixture` | Public MCP fixture server (https://mcp-release-fixture.vercel.app/mcp) |
| `fixtures/servers` | Localhost fixture MCP servers used in tests |

---

## Deployment

Two independent Vercel projects:

| Project | Root directory | URL |
|---|---|---|
| `mcp-release` | `apps/web` | https://mcprelease.dev |
| `mcp-release-fixture` | `apps/public-mcp-fixture` | https://mcp-release-fixture.vercel.app |

`apps/web` (`mcprelease.dev`) deploys automatically on every push to `main`. `apps/public-mcp-fixture` has automatic deployments disabled and is deployed manually.

`apps/web` depends on `packages/core` and `packages/reporter`. Its build command builds those packages first:

```
pnpm --filter @mcp-release/core build && pnpm --filter @mcp-release/reporter build && pnpm --filter @mcp-release/web build
```

`apps/public-mcp-fixture` has no sibling package dependencies and builds with `next build` directly.

---

## Local development

**Requirements:** Node.js ≥ 22.13.0, pnpm ≥ 10.28.0

```bash
pnpm install                  # install all workspace dependencies
pnpm typecheck                # TypeScript type check (all packages + apps)
pnpm lint                     # ESLint across the workspace
pnpm build                    # build all packages and apps
pnpm test                     # run all tests (500+ automated tests)
```

### Start the web app

```bash
pnpm --filter @mcp-release/web dev
# → http://localhost:3000
```

The development server shows fixture buttons (PASS / WARNING / FAIL) that load sample reports without making network requests. These buttons are removed in production builds.

### Web app structure

```
apps/web/src/
├── app/
│   ├── layout.tsx              HTML shell, metadata, OG tags
│   ├── page.tsx                Landing page
│   ├── docs/
│   │   └── page.tsx            Documentation page
│   └── api/check/
│       ├── handler.ts          Testable request handler
│       └── route.ts            Next.js route entry point
├── components/
│   ├── Header.tsx / .module.css
│   ├── Footer.tsx / .module.css
│   ├── CheckClient.tsx / .module.css   Client component (form, state)
│   └── Results.tsx / .module.css       Report display
└── lib/
    ├── constants.ts            SITE_URL, GITHUB_URL, DEMO_ENDPOINT, timeout bounds
    ├── rate-limit.ts           In-memory sliding-window rate limiter
    └── concurrency.ts          In-memory concurrency guard
```

### API contract

`POST /api/check` accepts `application/json`:

```json
{ "endpoint": "https://example.com/mcp", "timeoutMs": 10000 }
```

- `endpoint`: required, HTTPS only, no embedded credentials
- `timeoutMs`: optional, 1000-30000 ms (default 10000)
- Unexpected fields are rejected with `400 UNEXPECTED_FIELD`

Returns `200 { "report": CheckReport }` or a JSON error body with `error` and `message`.

### Abuse controls (in-memory)

- **Rate limit:** 10 requests per IP per minute (sliding window)
- **Concurrency:** max 5 simultaneous outbound checks

Both controls are per-process. See Known Limitations below.

---

## Known limitations

- **Public HTTPS endpoints only.** HTTP and private network endpoints are rejected.
- **No credential input.** Authenticated checks are not performed. Servers requiring authorization return `AUTH_REQUIRED` (WARNING).
- **Tools are not invoked.** Runtime correctness of tool responses is not validated.
- **A PASS is not a security guarantee.** It reflects the checks MCP Release ran. Runtime behavior may differ in other environments.
- **In-memory rate limiting.** Per-process only, not shared across horizontally-scaled instances.
- **Reports are not stored server-side.** Export before closing the tab.
- **x-forwarded-for** is used for rate limiting. Accurate behind a trusted proxy, not verified otherwise.

---

## Contributing

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm test
```

All PRs run the full suite via `.github/workflows/ci.yml`. The workflow uses SHA-pinned actions and pnpm 10.28.0.

Core validation behavior (transport, SSRF, DNS pinning, error classification, report format) is covered by tests in `packages/core/tests/`. Web UI behavior is covered by tests in `apps/web/tests/`.
