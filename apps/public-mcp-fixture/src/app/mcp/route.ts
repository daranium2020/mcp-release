// node:tls / node:net are not needed here (fixture is stateless),
// but Next.js defaults to Node.js runtime for App Router routes anyway.
// Declaring it explicitly prevents accidental Edge migration.
export const runtime = "nodejs";
export const maxDuration = 30;

import { handleMcpRequest } from "../../mcp-handler";

export async function POST(req: Request): Promise<Response> {
  return handleMcpRequest(req);
}

export function GET(): Response {
  return new Response(
    JSON.stringify({ error: "METHOD_NOT_ALLOWED", message: "MCP endpoint requires POST" }),
    { status: 405, headers: { "Content-Type": "application/json", Allow: "POST" } },
  );
}
