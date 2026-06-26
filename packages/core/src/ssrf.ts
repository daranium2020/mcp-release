import dns from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import net from "node:net";

export class SsrfError extends Error {
  constructor(
    message: string,
    public readonly reason: string,
  ) {
    super(message);
    this.name = "SsrfError";
  }
}

export type SsrfOptions = {
  allowHttp?: boolean; // only true in test/development
  maxRedirects?: number;
};

const MAX_REDIRECTS_DEFAULT = 3;

// IPv4 blocked ranges: [networkAddress, prefixLength]
const BLOCKED_IPV4_RANGES: Array<[number, number]> = [
  // Loopback
  [ipv4ToInt("127.0.0.0"), 8],
  // Private
  [ipv4ToInt("10.0.0.0"), 8],
  [ipv4ToInt("172.16.0.0"), 12],
  [ipv4ToInt("192.168.0.0"), 16],
  // Link-local
  [ipv4ToInt("169.254.0.0"), 16],
  // Carrier-grade NAT
  [ipv4ToInt("100.64.0.0"), 10],
  // Multicast
  [ipv4ToInt("224.0.0.0"), 4],
  // Reserved / broadcast
  [ipv4ToInt("240.0.0.0"), 4],
  [ipv4ToInt("0.0.0.0"), 8],
];

// Cloud metadata endpoints (exact IPs)
const BLOCKED_IPV4_EXACT = new Set([
  ipv4ToInt("169.254.169.254"), // AWS/GCP/Azure IMDS
]);

const BLOCKED_IPV6_PREFIXES: Array<[bigint, number]> = [
  // Loopback
  [ipv6ToBigInt("::1"), 128],
  // Unspecified
  [ipv6ToBigInt("::"), 128],
  // Link-local
  [ipv6ToBigInt("fe80::"), 10],
  // Site-local (deprecated but still blocked)
  [ipv6ToBigInt("fec0::"), 10],
  // Unique-local
  [ipv6ToBigInt("fc00::"), 7],
  // Multicast
  [ipv6ToBigInt("ff00::"), 8],
  // IPv4-mapped loopback ::ffff:127.0.0.0/8 handled via mapped check
];

// Cloud metadata IPv6 exact
const BLOCKED_IPV6_EXACT = new Set([
  ipv6ToBigInt("fd00:ec2::254"), // AWS IPv6 IMDS
]);

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  return (
    (((parts[0] ?? 0) << 24) |
      ((parts[1] ?? 0) << 16) |
      ((parts[2] ?? 0) << 8) |
      (parts[3] ?? 0)) >>>
    0
  );
}

function ipv6ToBigInt(ip: string): bigint {
  // Expand :: shorthand
  const expanded = expandIPv6(ip);
  const groups = expanded.split(":");
  let result = 0n;
  for (const group of groups) {
    result = (result << 16n) | BigInt(parseInt(group, 16));
  }
  return result;
}

function expandIPv6(ip: string): string {
  if (ip.includes("::")) {
    const [left, right] = ip.split("::");
    const leftGroups = (left ?? "").split(":").filter(Boolean);
    const rightGroups = (right ?? "").split(":").filter(Boolean);
    const missing = 8 - leftGroups.length - rightGroups.length;
    const middle = Array(missing).fill("0000") as string[];
    return [...leftGroups, ...middle, ...rightGroups]
      .map((g) => g.padStart(4, "0"))
      .join(":");
  }
  return ip
    .split(":")
    .map((g) => g.padStart(4, "0"))
    .join(":");
}

function isBlockedIPv4(ip: string): boolean {
  if (!net.isIPv4(ip)) return false;
  const n = ipv4ToInt(ip);
  if (BLOCKED_IPV4_EXACT.has(n)) return true;
  for (const [network, prefix] of BLOCKED_IPV4_RANGES) {
    const mask = prefix === 0 ? 0 : ~((1 << (32 - prefix)) - 1) >>> 0;
    if ((n & mask) >>> 0 === (network & mask) >>> 0) return true;
  }
  return false;
}

function isBlockedIPv6(ip: string): boolean {
  if (!net.isIPv6(ip)) return false;
  // Handle IPv4-mapped IPv6 (::ffff:x.x.x.x)
  const ipv4Mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (ipv4Mapped?.[1] !== undefined) {
    return isBlockedIPv4(ipv4Mapped[1]);
  }
  let n: bigint;
  try {
    n = ipv6ToBigInt(ip);
  } catch {
    return true; // cannot parse → block
  }
  if (BLOCKED_IPV6_EXACT.has(n)) return true;
  for (const [prefix, len] of BLOCKED_IPV6_PREFIXES) {
    if (len === 0) continue;
    const mask = len === 128 ? ~0n : ~((1n << BigInt(128 - len)) - 1n);
    if ((n & mask) === (prefix & mask)) return true;
  }
  return false;
}

export function isBlockedIp(ip: string): boolean {
  return isBlockedIPv4(ip) || isBlockedIPv6(ip);
}

export async function validateUrl(
  rawUrl: string,
  opts: SsrfOptions = {},
): Promise<void> {
  const { allowHttp = false } = opts;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError(`Invalid URL: ${rawUrl}`, "INVALID_URL");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new SsrfError(
      `Protocol not allowed: ${url.protocol}`,
      "PROTOCOL_NOT_ALLOWED",
    );
  }

  if (url.protocol === "http:") {
    if (!allowHttp) {
      throw new SsrfError(
        "HTTP is not allowed in production. Use HTTPS.",
        "HTTPS_REQUIRED",
      );
    }
    // HTTP only allowed for localhost in test/dev
    const hostname = url.hostname.toLowerCase();
    const isLocalhostLiteral =
      hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
    if (!isLocalhostLiteral) {
      throw new SsrfError(
        `HTTP is only allowed for localhost in development/test mode. Got: ${hostname}`,
        "HTTP_NON_LOCALHOST",
      );
    }
    // Skip IP-range check for explicitly allowed localhost HTTP — the hostname
    // has already been validated as a loopback literal.
    return;
  }

  await resolveAndCheckHost(url.hostname);
}

async function resolveAndCheckHost(hostname: string): Promise<void> {
  // If hostname is already an IP literal, check directly
  if (net.isIP(hostname) !== 0) {
    if (isBlockedIp(hostname)) {
      throw new SsrfError(
        `IP address is blocked: ${hostname}`,
        "BLOCKED_IP",
      );
    }
    return;
  }

  let records: LookupAddress[];
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch (err) {
    throw new SsrfError(
      `DNS resolution failed for ${hostname}: ${String(err)}`,
      "DNS_FAILURE",
    );
  }

  if (records.length === 0) {
    throw new SsrfError(
      `DNS returned no records for ${hostname}`,
      "DNS_NO_RECORDS",
    );
  }

  for (const record of records) {
    if (isBlockedIp(record.address)) {
      throw new SsrfError(
        `Resolved address is blocked: ${record.address} (for ${hostname})`,
        "BLOCKED_RESOLVED_IP",
      );
    }
  }
}

export async function validateRedirect(
  location: string,
  opts: SsrfOptions = {},
): Promise<void> {
  return validateUrl(location, opts);
}

export { MAX_REDIRECTS_DEFAULT };
