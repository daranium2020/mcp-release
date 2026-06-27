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
