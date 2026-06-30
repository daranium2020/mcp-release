export const runtime = "nodejs";
export const maxDuration = 30;

import { handleAuthRequest } from "../../matrix-handler";

export function POST(req: Request): Response {
  return handleAuthRequest(req);
}

export function GET(): Response {
  return new Response(
    JSON.stringify({ error: "METHOD_NOT_ALLOWED", message: "MCP endpoint requires POST" }),
    { status: 405, headers: { "Content-Type": "application/json", Allow: "POST" } },
  );
}
