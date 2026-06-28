// Public constants — safe to expose to the browser.
// Never place secrets, API keys, or private configuration here.

export const SITE_NAME = "MCP Release";
export const SITE_DESCRIPTION = "Release validation for MCP servers";

// Canonical public URL — used for metadataBase and Open Graph.
export const SITE_URL = "https://mcprelease.dev";

// Linked from the header — points to the public repository.
export const GITHUB_URL = "https://github.com/daranium2020/mcp-release";

export const DEMO_ENDPOINT = "https://mcp-release-fixture.vercel.app/mcp";

export const MIN_TIMEOUT_MS = 1_000;
export const MAX_TIMEOUT_MS = 30_000;
export const DEFAULT_TIMEOUT_MS = 10_000;
