/**
 * Pure MCP Streamable HTTP request handler.
 *
 * Implements the JSON-RPC 2.0 subset required for an MCP server to produce a
 * full PASS from MCP Release: initialize handshake, notifications/initialized,
 * and tools/list. tools/call is implemented for spec completeness with static,
 * side-effect-free responses — MCP Release never invokes tools.
 *
 * This module has no external dependencies, no environment variable reads, no
 * filesystem access, no outbound network calls, and no side effects.
 */

export const SERVER_INFO = {
  name: "public-mcp-fixture",
  version: "1.0.0",
} as const;

// Must be accepted by MCP SDK >=1.12.0 (LATEST_PROTOCOL_VERSION = "2025-03-26")
export const PROTOCOL_VERSION = "2025-03-26" as const;

const MAX_BODY_BYTES = 64 * 1024; // 64 KB — generous for spec-sized MCP messages

// ---------------------------------------------------------------------------
// Tool definitions
// Names must match /^[a-zA-Z_][a-zA-Z0-9_\-./]*$/.
// Descriptions must be non-empty strings.
// inputSchema must be valid JSON Schema (draft-07 default, compiled by AJV).
// outputSchema is omitted (optional field) to avoid any schema validation risk.
// ---------------------------------------------------------------------------
export const TOOLS = [
  {
    name: "echo",
    description: "Returns the input message unchanged. No external calls are made.",
    inputSchema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "The text to echo back",
        },
      },
      required: ["message"],
      additionalProperties: false,
    },
  },
  {
    name: "ping",
    description: "Returns a fixed pong response to verify server reachability.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
] as const;

// ---------------------------------------------------------------------------
// JSON-RPC types (subset)
// ---------------------------------------------------------------------------

type JsonRpcId = string | number | null;

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: unknown;
}

function isJsonRpcMessage(v: unknown): v is JsonRpcMessage {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const m = v as Record<string, unknown>;
  return m["jsonrpc"] === "2.0" && typeof m["method"] === "string";
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

const COMMON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

function jsonBody(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: COMMON_HEADERS });
}

function rpcOk(id: JsonRpcId, result: unknown): Response {
  return jsonBody({ jsonrpc: "2.0", id, result });
}

function rpcErr(id: JsonRpcId, code: number, message: string): Response {
  return jsonBody({ jsonrpc: "2.0", id, error: { code, message } });
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function handleMcpRequest(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "METHOD_NOT_ALLOWED", message: "MCP endpoint requires POST" }),
      { status: 405, headers: { ...COMMON_HEADERS, Allow: "POST" } },
    );
  }

  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    return jsonBody({ error: "UNSUPPORTED_MEDIA_TYPE", message: "Content-Type must be application/json" }, 415);
  }

  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch {
    return rpcErr(null, -32700, "Failed to read request body");
  }

  if (bodyText.length > MAX_BODY_BYTES) {
    return jsonBody({ error: "BODY_TOO_LARGE", message: `Request body exceeds ${MAX_BODY_BYTES} bytes` }, 413);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return rpcErr(null, -32700, "Parse error");
  }

  if (!isJsonRpcMessage(parsed)) {
    return rpcErr(null, -32600, "Invalid Request");
  }

  const msg = parsed;
  const id: JsonRpcId = msg.id ?? null;
  const isNotification = msg.id === undefined;

  switch (msg.method) {
    case "initialize": {
      return rpcOk(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    }

    case "notifications/initialized": {
      // Notification — client does not expect a response body.
      return new Response(null, { status: 204 });
    }

    case "tools/list": {
      return rpcOk(id, { tools: TOOLS });
    }

    case "tools/call": {
      // Implemented for protocol completeness.
      // MCP Release never invokes tools; these handlers perform no side effects.
      const params = msg.params as Record<string, unknown> | undefined;
      const toolName = params?.["name"];
      const args = (params?.["arguments"] as Record<string, unknown>) ?? {};

      if (toolName === "echo") {
        const message = typeof args["message"] === "string" ? args["message"] : "";
        return rpcOk(id, { content: [{ type: "text", text: message }] });
      }

      if (toolName === "ping") {
        return rpcOk(id, { content: [{ type: "text", text: "pong" }] });
      }

      return rpcErr(id, -32602, `Unknown tool: ${String(toolName)}`);
    }

    default: {
      if (isNotification) {
        return new Response(null, { status: 204 });
      }
      return rpcErr(id, -32601, "Method not found");
    }
  }
}

// ---------------------------------------------------------------------------
// Health handler
// ---------------------------------------------------------------------------

export const HEALTH_RESPONSE = {
  status: "ok",
  service: SERVER_INFO.name,
  version: SERVER_INFO.version,
} as const;

export function handleHealthRequest(req: Request): Response {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response(
      JSON.stringify({ error: "METHOD_NOT_ALLOWED", message: "Health endpoint requires GET" }),
      { status: 405, headers: { ...COMMON_HEADERS, Allow: "GET, HEAD" } },
    );
  }
  return new Response(JSON.stringify(HEALTH_RESPONSE), {
    status: 200,
    headers: COMMON_HEADERS,
  });
}
