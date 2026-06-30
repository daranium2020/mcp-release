export const runtime = "nodejs";
export const maxDuration = 30;

import { handleWarningRequest } from "../../matrix-handler";

export async function POST(req: Request): Promise<Response> {
  return handleWarningRequest(req);
}

export function GET(): Response {
  return new Response(
    JSON.stringify({ error: "METHOD_NOT_ALLOWED", message: "MCP endpoint requires POST" }),
    { status: 405, headers: { "Content-Type": "application/json", Allow: "POST" } },
  );
}
