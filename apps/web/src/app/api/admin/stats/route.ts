import { getAggregates } from "../../../../lib/usage-log";

// Returns per-process aggregate check counts.
// Disabled (404) when ADMIN_TOKEN env var is not set.
export function GET(req: Request): Response {
  const token = process.env.ADMIN_TOKEN;
  if (!token) {
    return new Response(null, { status: 404 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${token}`) {
    return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), {
      status: 401,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  return new Response(
    JSON.stringify({
      aggregates: getAggregates(),
      note: "per-process only — resets on cold start",
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    },
  );
}
