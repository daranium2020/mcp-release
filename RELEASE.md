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
mcp-release --version          # must match the version in packages/cli/package.json
mcp-release check https://mcp-release-fixture.vercel.app/mcp
```

## Release steps

1. Merge the release PR into `main`.
2. Pull the latest `main` locally:
   ```bash
   git checkout main && git pull --ff-only origin main
   ```
3. Create an annotated tag:
   ```bash
   git tag -a v0.1.1 -m "v0.1.1"
   ```
4. Push the tag:
   ```bash
   git push origin v0.1.1
   ```
5. **CLI publish — SKIPPED for v0.1.1.** The CLI logic is unchanged from 0.1.0.
   `@mcp-release/cli` remains at 0.1.0 on npm. Do not run `npm publish`.
6. Create a GitHub release from the tag at https://github.com/daranium2020/mcp-release/releases/new.
   - Use the changelog entry as the release description.
   - Do not attach binary assets.
7. Verify the existing CLI still works (no new publish needed):
   ```bash
   npm install -g @mcp-release/cli   # installs 0.1.0
   mcp-release --version             # should print 0.1.0
   mcp-release check https://mcp-release-fixture.vercel.app/mcp
   ```
8. Verify npx usage:
   ```bash
   npx @mcp-release/cli check https://mcp-release-fixture.vercel.app/mcp
   ```
9. Verify GitHub Action usage with the published tag in a test workflow:
   ```yaml
   uses: daranium2020/mcp-release@v0.1.1
   ```

## Rollback notes

- npm does not allow unpublishing a version after 72 hours. Do not rely on `npm unpublish` as a rollback path.
- If a packaging issue is found after publish, release a patch version (`0.1.1`) with the fix.
- If a critical security issue is found, deprecate the affected version with `npm deprecate @mcp-release/cli@0.1.0 "reason"` and publish a patched version immediately.
- Delete a GitHub release only if no users depend on that tag yet; prefer releasing a fixed version instead.
- Never force-push or delete `main` after a release tag has been created from it.
