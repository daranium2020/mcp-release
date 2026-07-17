import type { FindingCode } from "@mcp-release/core";

export const REMEDIATION: Partial<Record<FindingCode, string>> = {
  TRANSPORT_ERROR: "Verify the server is running and the URL is reachable.",
  AUTH_REQUIRED: "Pass credentials via `--header`, `--header-env`, or `--bearer-token-env`.",
  REMOTE_HTTP_ERROR: "Check server logs for details of the unexpected HTTP response.",
  HTTP_ERROR: "Verify the endpoint URL is correct and the server is accessible.",
  TIMEOUT: "Increase `--timeout-ms` or check that the server responds promptly.",
  REDIRECT_LIMIT_EXCEEDED: "Investigate the redirect chain; use `--max-redirects` to raise the limit.",
  REDIRECT_LOOP: "Fix the redirect cycle in the server or proxy configuration.",
  PROTOCOL_DOWNGRADE: "Ensure all redirects use HTTPS, not HTTP.",
  SSRF_BLOCKED: "Only public HTTPS endpoints are accepted by the browser checker.",
  HTTPS_REQUIRED: "Use an `https://` URL. HTTP connections are not allowed in production.",
  EMBEDDED_CREDENTIALS: "Remove credentials from the URL. Use `--header` or `--bearer-token-env` instead.",
  INIT_FAILURE: "Ensure the server completes MCP `initialize` / `initialized` handshake correctly.",
  PROTOCOL_VERSION_MISMATCH: "Update the server to use a supported MCP protocol version.",
  TOOLS_LIST_FAILURE: "Ensure the server implements the `tools/list` MCP method.",
  TOOL_INVALID_NAME: "Rename the tool — names must match `^[a-zA-Z0-9_-]{1,64}$`.",
  TOOL_MISSING_DESCRIPTION: "Add a `description` field to the tool definition.",
  TOOL_EMPTY_DESCRIPTION: "Provide a meaningful, non-empty description for the tool.",
  TOOL_INVALID_INPUT_SCHEMA: "Fix the JSON Schema in the tool's `inputSchema` field.",
  TOOL_INVALID_OUTPUT_SCHEMA: "Fix the JSON Schema in the tool's `outputSchema` field.",
  TOOL_UNSUPPORTED_SCHEMA_DRAFT: "Use JSON Schema draft-07 for tool input and output schemas.",
  TOOL_DUPLICATE_NAME: "Ensure all tool names are unique within the server.",
  STDIO_UNEXPECTED_OUTPUT:
    "Move all logging and debug output to stderr. Only MCP protocol messages should appear on stdout.",
  STDIO_FRAMING_ERROR:
    "Each stdout line must be a complete, valid JSON-RPC message terminated by a single newline.",
  STDIO_SHUTDOWN_TIMEOUT: "Ensure the process exits cleanly when stdin is closed (EOF).",
  STDIO_PROCESS_ERROR:
    "Verify the command is correct and that the server starts without errors.",
  STDIO_RESPONSE_SIZE_EXCEEDED:
    "Reduce the size of MCP protocol messages written to stdout.",
};
