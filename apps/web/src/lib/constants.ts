// Public constants. Safe to expose to the browser.
// Never place secrets, API keys, or private configuration here.

export const SITE_NAME = "MCP Release";
export const SITE_DESCRIPTION = "MCP server validation";

// Product version embedded in all browser-originated reports.
// Update alongside root package.json and all workspace package versions.
export const PRODUCT_VERSION = "0.3.0";

// Canonical public URL for metadataBase and Open Graph.
export const SITE_URL = "https://mcprelease.dev";

export const DEMO_ENDPOINT = "https://mcp-release-fixture.vercel.app/mcp";

export const MIN_TIMEOUT_MS = 1_000;
export const MAX_TIMEOUT_MS = 30_000;
export const DEFAULT_TIMEOUT_MS = 10_000;
