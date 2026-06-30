/**
 * Controlled fixture handlers for the MCP Release validation test matrix.
 *
 * Each handler is designed to produce a specific overallStatus from runCheck:
 *
 *   handleWarningRequest      → WARNING  (tool with empty description)
 *   handleFailRequest         → FAIL     (tool with invalid name)
 *   handleAuthRequest         → WARNING  (401 → AUTH_REQUIRED)
 *   handleProtocolErrorRequest → FAIL    (JSON-RPC error on initialize)
 *
 * None of these handlers execute tools or make outbound network calls.
 * The existing /mcp endpoint (handleMcpRequest) is not modified.
 */

import { PROTOCOL_VERSION, SERVER_INFO } from "./mcp-handler";

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

const MATRIX_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

type RpcId = string | number | null;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: MATRIX_HEADERS,
  });
}

function rpcOk(id: RpcId, result: unknown): Response {
  return jsonResponse({ jsonrpc: "2.0", id, result });
}

function rpcErr(id: RpcId, code: number, message: string): Response {
  return jsonResponse({ jsonrpc: "2.0", id, error: { code, message } });
}

/**
 * Parse an incoming JSON-RPC 2.0 request body.
 *
 * Returns the parsed message fields, or an early Response if the request is
 * malformed or uses an unsupported HTTP method / Content-Type.
 */
async function readRpcMessage(
  req: Request,
): Promise<
  | { ok: true; method: string; id: RpcId; isNotification: boolean }
  | { ok: false; response: Response }
> {
  if (req.method !== "POST") {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), {
        status: 405,
        headers: { ...MATRIX_HEADERS, Allow: "POST" },
      }),
    };
  }
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    return { ok: false, response: jsonResponse({ error: "UNSUPPORTED_MEDIA_TYPE" }, 415) };
  }
  let body: unknown;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return { ok: false, response: rpcErr(null, -32700, "Parse error") };
  }
  if (
    typeof body !== "object" ||
    body === null ||
    (body as Record<string, unknown>)["jsonrpc"] !== "2.0" ||
    typeof (body as Record<string, unknown>)["method"] !== "string"
  ) {
    return { ok: false, response: rpcErr(null, -32600, "Invalid Request") };
  }
  const msg = body as Record<string, unknown>;
  const rawId = msg["id"];
  const id: RpcId =
    typeof rawId === "string" || typeof rawId === "number" ? rawId : null;
  return {
    ok: true,
    method: msg["method"] as string,
    id,
    isNotification: msg["id"] === undefined,
  };
}

// ---------------------------------------------------------------------------
// WARNING fixture — /mcp-warning
//
// Valid MCP server with one tool that has an empty description.
// Produces: TOOL_EMPTY_DESCRIPTION WARNING → overallStatus WARNING
// ---------------------------------------------------------------------------

const WARNING_TOOLS = [
  {
    name: "echo",
    description: "Returns the input message unchanged.",
    inputSchema: {
      type: "object",
      properties: { message: { type: "string", description: "The text to echo back" } },
      required: ["message"],
      additionalProperties: false,
    },
  },
  {
    name: "undescribed_tool",
    description: "", // empty string → TOOL_EMPTY_DESCRIPTION WARNING
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
] as const;

export async function handleWarningRequest(req: Request): Promise<Response> {
  const msg = await readRpcMessage(req);
  if (!msg.ok) return msg.response;
  const { method, id, isNotification } = msg;

  switch (method) {
    case "initialize":
      return rpcOk(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { ...SERVER_INFO, name: "mcp-fixture-warning" },
      });
    case "notifications/initialized":
      return new Response(null, { status: 204 });
    case "tools/list":
      return rpcOk(id, { tools: WARNING_TOOLS });
    default:
      return isNotification
        ? new Response(null, { status: 204 })
        : rpcErr(id, -32601, "Method not found");
  }
}

// ---------------------------------------------------------------------------
// FAIL fixture — /mcp-fail
//
// Valid MCP handshake, but tools/list returns a tool with an invalid name.
// Produces: TOOL_INVALID_NAME FAIL → overallStatus FAIL
// ---------------------------------------------------------------------------

const FAIL_TOOLS = [
  {
    name: "invalid tool name!", // spaces and ! → TOOL_INVALID_NAME FAIL
    description: "A tool with an intentionally invalid name for testing.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
] as const;

export async function handleFailRequest(req: Request): Promise<Response> {
  const msg = await readRpcMessage(req);
  if (!msg.ok) return msg.response;
  const { method, id, isNotification } = msg;

  switch (method) {
    case "initialize":
      return rpcOk(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { ...SERVER_INFO, name: "mcp-fixture-fail" },
      });
    case "notifications/initialized":
      return new Response(null, { status: 204 });
    case "tools/list":
      return rpcOk(id, { tools: FAIL_TOOLS });
    default:
      return isNotification
        ? new Response(null, { status: 204 })
        : rpcErr(id, -32601, "Method not found");
  }
}

// ---------------------------------------------------------------------------
// AUTH_REQUIRED fixture — /mcp-auth
//
// Always returns HTTP 401. No credentials are accepted or stored.
// Produces: AUTH_REQUIRED WARNING → overallStatus WARNING
// ---------------------------------------------------------------------------

export function handleAuthRequest(req: Request): Response {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), {
      status: 405,
      headers: { ...MATRIX_HEADERS, Allow: "POST" },
    });
  }
  return new Response(
    JSON.stringify({
      error: "Unauthorized",
      message: "Authentication required.",
    }),
    {
      status: 401,
      headers: { ...MATRIX_HEADERS, "WWW-Authenticate": 'Bearer realm="mcp-fixture"' },
    },
  );
}

// ---------------------------------------------------------------------------
// PROTOCOL_ERROR fixture — /mcp-protocol-error
//
// Returns a JSON-RPC 2.0 error response to the initialize request.
// The MCP SDK expects initialize to return a result; receiving an error
// causes connect() to throw McpError{code: -32600}.
//
// Classification: extractHttpStatus() rejects -32600 (outside 100–599);
// extractRpcErrorCode() detects the negative integer → INIT_FAILURE FAIL.
// ---------------------------------------------------------------------------

export async function handleProtocolErrorRequest(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), {
      status: 405,
      headers: { ...MATRIX_HEADERS, Allow: "POST" },
    });
  }

  // Parse the body to echo back the matching id — without this, the SDK
  // may not match the error to its pending initialize request.
  let id: RpcId = null;
  try {
    const body = JSON.parse(await req.text()) as Record<string, unknown>;
    const rawId = body["id"];
    if (typeof rawId === "string" || typeof rawId === "number") {
      id = rawId;
    }
  } catch {
    // ignore — id stays null
  }

  return jsonResponse({
    jsonrpc: "2.0",
    id,
    error: {
      code: -32600,
      message: "Protocol version not supported. MCP initialization refused.",
    },
  });
}
