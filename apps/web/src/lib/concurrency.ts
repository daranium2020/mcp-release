// In-memory concurrency guard.
//
// Limits the number of simultaneous outbound validation requests to protect
// against resource exhaustion. Per-process state — same horizontal-scaling
// caveat as the rate limiter applies.

export type ConcurrencyGuard = {
  tryAcquire(): boolean;
  release(): void;
  activeCount(): number;
};

export function createConcurrencyGuard(opts: { max: number }): ConcurrencyGuard {
  let active = 0;
  return {
    tryAcquire() {
      if (active >= opts.max) return false;
      active++;
      return true;
    },
    release() {
      active = Math.max(0, active - 1);
    },
    activeCount() {
      return active;
    },
  };
}

// 5 concurrent checks — default singleton used by the API route.
export const defaultConcurrencyGuard = createConcurrencyGuard({ max: 5 });
