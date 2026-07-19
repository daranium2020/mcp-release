import { describe, it, expect, vi, afterEach } from "vitest";
import { parseRetryAfterMs } from "../src/rate-limit.js";

afterEach(() => { vi.useRealTimers(); });

describe("parseRetryAfterMs — seconds format", () => {
  it("returns ms for integer seconds", () => {
    expect(parseRetryAfterMs("120")).toBe(120_000);
  });

  it("returns 0 for '0'", () => {
    expect(parseRetryAfterMs("0")).toBe(0);
  });

  it("handles leading/trailing whitespace", () => {
    expect(parseRetryAfterMs("  30  ")).toBe(30_000);
  });

  it("returns null for a non-integer string", () => {
    expect(parseRetryAfterMs("abc")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(parseRetryAfterMs(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseRetryAfterMs("")).toBeNull();
  });

  it("returns null for a decimal", () => {
    // "30.5" contains a dot — not purely digits — so treated as an HTTP date
    // that also fails to parse. Either way it must return null.
    expect(parseRetryAfterMs("30.5")).toBeNull();
  });
});

describe("parseRetryAfterMs — HTTP date format", () => {
  it("returns positive ms for a future HTTP date", () => {
    vi.useFakeTimers({ now: new Date("2026-07-19T10:00:00.000Z") });
    const futureDate = "Sun, 19 Jul 2026 10:00:30 GMT";
    const result = parseRetryAfterMs(futureDate);
    expect(result).toBeGreaterThanOrEqual(29_000);
    expect(result).toBeLessThanOrEqual(31_000);
  });

  it("returns 0 for a past HTTP date", () => {
    vi.useFakeTimers({ now: new Date("2026-07-19T10:00:00.000Z") });
    const pastDate = "Sun, 19 Jul 2026 09:00:00 GMT";
    expect(parseRetryAfterMs(pastDate)).toBe(0);
  });

  it("returns null for an unparseable string", () => {
    expect(parseRetryAfterMs("not-a-date")).toBeNull();
  });
});
