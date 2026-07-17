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
mcp-release --version          # must print 0.2.0
mcp-release check https://mcp-release-fixture.vercel.app/mcp
```

**Smoke test stdio transport (new in v0.2.0):**

```bash
# Verify stdio mode works end-to-end
mcp-release check --stdio --command "node fixtures/servers/src/stdio/valid-server.mjs"
# Expected: PASS with INIT_OK and one tool (echo)

# Verify stdout-logging server produces WARNING
mcp-release check --stdio --command "node fixtures/servers/src/stdio/stdout-logger.mjs"
# Expected: WARNING with STDIO_UNEXPECTED_OUTPUT
```

## Release steps

1. Merge the release PR into `main`.
2. Pull the latest `main` locally:
   ```bash
   git checkout main && git pull --ff-only origin main
   ```
3. Create an annotated tag:
   ```bash
   git tag -a v0.2.0 -m "v0.2.0"
   ```
4. Push the tag:
   ```bash
   git push origin v0.2.0
   ```
5. **Publish the CLI to npm:**
   ```bash
   cd packages/cli
   npm publish
   ```
   Confirm the published version is `0.2.0` at https://www.npmjs.com/package/@mcp-release/cli.
6. Create a GitHub release from the tag at https://github.com/daranium2020/mcp-release/releases/new.
   - Use the changelog entry as the release description.
   - Do not attach binary assets.
7. Verify the new CLI version:
   ```bash
   npm install -g @mcp-release/cli   # installs 0.2.0
   mcp-release --version             # should print 0.2.0
   mcp-release check https://mcp-release-fixture.vercel.app/mcp
   mcp-release check --stdio --command "npx -y @modelcontextprotocol/server-everything"
   ```
8. Verify npx usage:
   ```bash
   npx @mcp-release/cli check https://mcp-release-fixture.vercel.app/mcp
   npx @mcp-release/cli check --stdio --command "npx -y @modelcontextprotocol/server-everything"
   ```
9. Verify GitHub Action usage with the published tag in a test workflow:
   ```yaml
   # HTTP transport
   uses: daranium2020/mcp-release@v0.2.0
   with:
     endpoint: https://mcp-release-fixture.vercel.app/mcp

   # Stdio transport
   uses: daranium2020/mcp-release@v0.2.0
   with:
     transport: stdio
     command: npx -y @modelcontextprotocol/server-everything
   ```

## Rollback notes

- npm does not allow unpublishing a version after 72 hours. Do not rely on `npm unpublish` as a rollback path.
- If a packaging issue is found after publish, release a patch version (`0.2.1`) with the fix.
- If a critical security issue is found, deprecate the affected version with `npm deprecate @mcp-release/cli@0.2.0 "reason"` and publish a patched version immediately.
- Delete a GitHub release only if no users depend on that tag yet; prefer releasing a fixed version instead.
- Never force-push or delete `main` after a release tag has been created from it.
