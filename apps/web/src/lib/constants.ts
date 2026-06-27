// Public constants — safe to expose to the browser.
// Never place secrets, API keys, or private configuration here.

export const SITE_NAME = "MCP Launch";
export const SITE_DESCRIPTION = "Release validation for MCP servers";

// Linked from the header — points to the public repository.
// Replace with the actual repo URL before first public deployment.
export const GITHUB_URL = "https://github.com/daranium2020/mcp-launch";

export const MIN_TIMEOUT_MS = 1_000;
export const MAX_TIMEOUT_MS = 30_000;
export const DEFAULT_TIMEOUT_MS = 10_000;
