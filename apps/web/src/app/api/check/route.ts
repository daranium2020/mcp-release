// Route-segment config: pin runtime and cap function duration.
// node:tls / node:net / node:dns/promises / undici Agent are Node.js-only;
// Edge runtime would fail at import time.
export const runtime = "nodejs";
// 35 s internal hard cap (MAX_EXECUTION_MS) + 5 s Vercel teardown margin.
// Lowers the function ceiling from the 300 s fluid-compute default.
export const maxDuration = 40;

import { handleCheckRequest } from "./handler";

export async function POST(req: Request): Promise<Response> {
  return handleCheckRequest(req);
}

// Explicitly disallow other methods at the route level.
export function GET(): Response {
  return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED", message: "Only POST is accepted" }), {
    status: 405,
    headers: { "Content-Type": "application/json", "Allow": "POST" },
  });
}
