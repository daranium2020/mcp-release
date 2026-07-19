# Release checklist

## Pre-release checks

Run all of these from the repo root before tagging or publishing:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm smoke:production
```

From `packages/cli`:

```bash
npm pack --dry-run
```

Confirm tarball includes `LICENSE`, `README.md`, `dist/index.js`, `package.json` and nothing else.

Install the tarball into a temporary directory and verify:

```bash
mcp-release --help
mcp-release --version          # must print 0.3.0
mcp-release check https://mcp-release-fixture.vercel.app/mcp
```

**Smoke test config-file scenarios (new in v0.3.0):**

```bash
# Validate with a YAML config file
mcp-release check --config mcp-release.config.yml

# JSON report
mcp-release check --config mcp-release.config.yml --json | jq '.scenarios[].name'

# Markdown report
mcp-release check --config mcp-release.config.yml --markdown
```

**Smoke test stdio transport:**

```bash
mcp-release check --stdio --command "node fixtures/servers/src/stdio/valid-server.mjs"
# Expected: PASS with INIT_OK and one tool; transportType: stdio, executionEnvironment: cli

mcp-release check --stdio --command "node fixtures/servers/src/stdio/stdout-logger.mjs"
# Expected: WARNING with STDIO_UNEXPECTED_OUTPUT

mcp-release check --stdio --command "node fixtures/servers/src/stdio/valid-server.mjs" --json | jq 'has("transport")'
# Expected: false
```

**Smoke test transport-aware report fields:**

```bash
mcp-release check https://mcp-release-fixture.vercel.app/mcp --json | jq '{transportType, executionEnvironment, mcpReleaseVersion, startedAt}'
# Expected: {"transportType":"http","executionEnvironment":"cli","mcpReleaseVersion":"0.3.0","startedAt":"<ISO timestamp>"}
```

## Release steps

1. Merge the release PR into `main`.
2. Pull the latest `main` locally:
   ```bash
   git checkout main && git pull --ff-only origin main
   ```
3. Create an annotated tag:
   ```bash
   git tag -a v0.3.0 -m "v0.3.0"
   ```
4. Push the tag:
   ```bash
   git push origin v0.3.0
   ```
5. **Publish the CLI to npm:**
   ```bash
   cd packages/cli
   npm publish
   ```
   Confirm the published version is `0.3.0` at https://www.npmjs.com/package/@mcp-release/cli.
6. Create a GitHub release from the tag at https://github.com/daranium2020/mcp-release/releases/new.
   - Use the prepared release notes (see below).
   - Do not attach binary assets.
7. Verify the new CLI version:
   ```bash
   npm install -g @mcp-release/cli   # installs 0.3.0
   mcp-release --version             # should print 0.3.0
   mcp-release check https://mcp-release-fixture.vercel.app/mcp
   mcp-release check --stdio --command "npx -y @modelcontextprotocol/server-everything"
   mcp-release check --config mcp-release.config.yml
   ```
8. Verify npx usage:
   ```bash
   npx @mcp-release/cli check https://mcp-release-fixture.vercel.app/mcp
   npx @mcp-release/cli check --config mcp-release.config.yml
   ```
9. Verify GitHub Action usage with the published tag in a test workflow:
   ```yaml
   # HTTP transport
   uses: daranium2020/mcp-release@v0.3.0
   with:
     endpoint: https://mcp-release-fixture.vercel.app/mcp

   # Stdio transport
   uses: daranium2020/mcp-release@v0.3.0
   with:
     transport: stdio
     command: npx -y @modelcontextprotocol/server-everything

   # Config-file scenarios (new in v0.3.0)
   uses: daranium2020/mcp-release@v0.3.0
   with:
     config: mcp-release.config.yml
   ```
10. Verify production deployment at https://mcprelease.dev — homepage, browser checker, and /docs.
11. Confirm CI passes on `main` after the tag push.

## Rollback notes

- npm does not allow unpublishing a version after 72 hours. Do not rely on `npm unpublish` as a rollback path.
- If a packaging issue is found after publish, release a patch version (`0.3.1`) with the fix.
- If a critical security issue is found, deprecate the affected version with `npm deprecate @mcp-release/cli@0.3.0 "reason"` and publish a patched version immediately.
- Delete a GitHub release only if no users depend on that tag yet; prefer releasing a fixed version instead.
- Never force-push or delete `main` after a release tag has been created from it.

---

## Release notes (v0.3.0)

**Title:** MCP Release v0.3.0

See `CHANGELOG.md` for the full entry. The public GitHub Release description is in this file below.

---

### MCP Release v0.3.0

MCP Release v0.3.0 adds configuration-file based scenario testing, authenticated endpoint validation, detailed resilience controls (retries, Retry-After, per-timeout classification), hard scenario deadlines, and expanded redaction. All existing HTTP and stdio checks continue to work without modification.

#### Configuration-file scenarios

Run multiple named checks — authenticated, unauthenticated, and expected-failure — in a single command:

```bash
mcp-release check --config mcp-release.config.yml
```

Example configuration:

```yaml
server:
  url: https://your-server.example.com/mcp

scenarios:
  - name: anonymous
    expect:
      result: warning
      httpStatus: 401

  - name: authenticated
    headers:
      Authorization: "Bearer ${MCP_TOKEN}"
    expect:
      result: pass

  - name: read-only
    headers:
      Authorization: "Bearer ${READ_ONLY_TOKEN}"
    expect:
      result: pass
```

Environment variables are substituted at runtime. Tokens are never stored or forwarded to MCP Release.

#### Retry and resilience

Retries are **off by default**. Enable explicitly with `retryOn`:

```yaml
retries:
  maxAttempts: 3
  backoffMs: 1000
  retryOn:
    - rate-limit
    - server-error
    - connection-failure
    - response-timeout
```

#### Auth finding codes

| Code | Condition |
|---|---|
| `AUTH_REQUIRED` | 401 with no credentials sent |
| `AUTH_INVALID` | 401 with credentials — token rejected |
| `AUTH_EXPIRED` | 401 with explicit unambiguous expiry indicator (`error="expired"` or `error="token_expired"`) |
| `AUTH_FORBIDDEN` | 403 — credentials lack required permissions |

**Note:** RFC 6750 `error="invalid_token"` produces `AUTH_INVALID`, not `AUTH_EXPIRED`, because that code covers expired, revoked, and malformed tokens and is too broad for an expiry-specific classification.

#### New finding codes

| Code | Meaning |
|---|---|
| `CONNECT_TIMEOUT` | TLS or TCP connection did not complete within the timeout |
| `RESPONSE_TIMEOUT` | Connection succeeded but no response received in time |
| `SCENARIO_TIMEOUT` | Hard wall-clock scenario budget exceeded (aborts in-flight requests) |
| `RATE_LIMITED` | Server returned HTTP 429 |
| `RETRY_EXHAUSTED` | All configured retry attempts failed |
| `SCENARIO_MISMATCH` | Scenario's `expect` block did not match the actual outcome |

#### GitHub Action

```yaml
- name: Validate MCP server scenarios
  uses: daranium2020/mcp-release@v0.3.0
  with:
    config: mcp-release.config.yml
  env:
    MCP_TOKEN: ${{ secrets.MCP_TOKEN }}
    READ_ONLY_TOKEN: ${{ secrets.READ_ONLY_TOKEN }}
```

#### Links

- npm: `@mcp-release/cli@0.3.0`
- GitHub Action: `daranium2020/mcp-release@v0.3.0`
- Website: https://mcprelease.dev
- Documentation: https://mcprelease.dev/docs
