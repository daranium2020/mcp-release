/**
 * Retry-After header parsing.
 *
 * RFC 9110 §10.2.3 — the field value is either:
 *   - A non-negative decimal integer (delay-seconds), or
 *   - An HTTP date (IMF-fixdate format)
 *
 * Returns the number of milliseconds to wait, or null when the header is
 * absent or unparseable. Never returns a negative number.
 */
export function parseRetryAfterMs(retryAfterHeader: string | null): number | null {
  if (retryAfterHeader === null || retryAfterHeader.trim() === "") return null;

  const trimmed = retryAfterHeader.trim();

  // Integer seconds: "120", "0"
  if (/^\d+$/.test(trimmed)) {
    const seconds = parseInt(trimmed, 10);
    if (!Number.isFinite(seconds)) return null;
    return Math.max(0, seconds * 1000);
  }

  // HTTP date: "Wed, 21 Oct 2026 07:28:00 GMT"
  const date = new Date(trimmed);
  if (!Number.isNaN(date.getTime())) {
    const waitMs = date.getTime() - Date.now();
    return Math.max(0, waitMs);
  }

  return null;
}

/**
 * Maximum Retry-After delay we will honour before giving up.
 * Prevents a malicious server from causing an arbitrarily long wait.
 */
export const MAX_RETRY_AFTER_MS = 60_000;

/**
 * Wait for the Retry-After delay, capped at MAX_RETRY_AFTER_MS.
 * Returns the actual wait time in ms (post-cap), or 0 if skipped.
 */
export function clampRetryAfterMs(rawMs: number): number {
  return Math.min(rawMs, MAX_RETRY_AFTER_MS);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
