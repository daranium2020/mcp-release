// In-memory sliding-window rate limiter.
//
// MVP LIMITATION: State is per-process and resets on restart. This is
// sufficient for single-instance local or low-traffic deployment but MUST
// be replaced with a shared store (Redis, Upstash, etc.) before running
// multiple horizontally-scaled instances in production.

type Bucket = { count: number; windowStart: number };

export type RateLimiter = {
  tryConsume(ip: string): boolean;
  resetAll(): void;
};

export function createRateLimiter(opts: {
  maxPerWindow: number;
  windowMs: number;
}): RateLimiter {
  const map = new Map<string, Bucket>();

  return {
    tryConsume(ip) {
      const now = Date.now();
      const bucket = map.get(ip);
      if (!bucket || now - bucket.windowStart >= opts.windowMs) {
        map.set(ip, { count: 1, windowStart: now });
        return true;
      }
      if (bucket.count >= opts.maxPerWindow) return false;
      bucket.count++;
      return true;
    },
    resetAll() {
      map.clear();
    },
  };
}

// 10 requests per IP per minute — default singleton used by the API route.
export const defaultRateLimiter = createRateLimiter({
  maxPerWindow: 10,
  windowMs: 60_000,
});
