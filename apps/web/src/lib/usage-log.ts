export type Outcome = "pass" | "warn" | "fail" | "error";

// Per-process aggregate counts. Resets on cold start; not shared across instances.
// Same lifecycle limitation as the in-memory rate limiter and concurrency guard.
const counts = { total: 0, pass: 0, warn: 0, fail: 0, error: 0 };

export function logCheckStart(hostname: string): void {
  console.log(
    JSON.stringify({ event: "check.start", hostname, ts: new Date().toISOString() }),
  );
}

export function logCheckComplete(
  hostname: string,
  outcome: Outcome,
  duration_ms: number,
  tools?: number,
  error_category?: string,
): void {
  counts.total++;
  counts[outcome]++;
  const entry: Record<string, unknown> = {
    event: "check.complete",
    hostname,
    status: outcome,
    duration_ms,
    ts: new Date().toISOString(),
  };
  if (tools !== undefined) entry.tools = tools;
  if (error_category !== undefined) entry.error_category = error_category;
  console.log(JSON.stringify(entry));
}

export function getAggregates(): typeof counts {
  return { ...counts };
}
