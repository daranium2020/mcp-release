import net from "node:net";
import { systemDnsResolver, type DnsResolver } from "./dns.js";

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
  /** Allow HTTP — only valid for localhost in test/development */
  allowHttp?: boolean;
  maxRedirects?: number;
  /**
   * Injectable DNS resolver for deterministic testing.
   * Production code always uses the system resolver.
   */
  dnsResolver?: DnsResolver;
};

/** Information returned by resolveUrlForPinning; used to create a pinned connection. */
export type ResolvedUrl = {
  hostname: string;
  port: number;
  isHttps: boolean;
  /** All validated resolved IP addresses (empty for localhost HTTP in dev mode). */
  resolvedIps: string[];
};

const MAX_REDIRECTS_DEFAULT = 3;

// IPv4 blocked ranges: [networkAddress, prefixLength]
const BLOCKED_IPV4_RANGES: Array<[number, number]> = [
  [ipv4ToInt("127.0.0.0"), 8],    // Loopback
  [ipv4ToInt("10.0.0.0"), 8],     // RFC 1918
  [ipv4ToInt("172.16.0.0"), 12],  // RFC 1918
  [ipv4ToInt("192.168.0.0"), 16], // RFC 1918
  [ipv4ToInt("169.254.0.0"), 16], // Link-local
  [ipv4ToInt("100.64.0.0"), 10],  // Carrier-grade NAT (RFC 6598)
  [ipv4ToInt("224.0.0.0"), 4],    // Multicast
  [ipv4ToInt("240.0.0.0"), 4],    // Reserved / future use
  [ipv4ToInt("0.0.0.0"), 8],      // "This" network
  // Documentation ranges (RFC 5737) — should never be routable
  [ipv4ToInt("192.0.2.0"), 24],
  [ipv4ToInt("198.51.100.0"), 24],
  [ipv4ToInt("203.0.113.0"), 24],
  // Shared address space (RFC 5736)
  [ipv4ToInt("192.0.0.0"), 24],
  // Benchmarking (RFC 2544)
  [ipv4ToInt("198.18.0.0"), 15],
];

// Cloud metadata endpoints (exact IPs)
const BLOCKED_IPV4_EXACT = new Set([
  ipv4ToInt("169.254.169.254"), // AWS/GCP/Azure IMDS
]);

const BLOCKED_IPV6_PREFIXES: Array<[bigint, number]> = [
  [ipv6ToBigInt("::1"), 128],      // Loopback
  [ipv6ToBigInt("::"), 128],       // Unspecified
  [ipv6ToBigInt("fe80::"), 10],    // Link-local
  [ipv6ToBigInt("fec0::"), 10],    // Site-local (deprecated, still blocked)
  [ipv6ToBigInt("fc00::"), 7],     // Unique-local (fc00::/7 covers fc00:: and fd00::)
  [ipv6ToBigInt("ff00::"), 8],     // Multicast
  [ipv6ToBigInt("64:ff9b::"), 96], // NAT64 (RFC 6052)
  [ipv6ToBigInt("100::"), 64],     // Discard (RFC 6666)
  [ipv6ToBigInt("2001:db8::"), 32],// Documentation (RFC 3849)
];

const BLOCKED_IPV6_EXACT = new Set([
  ipv6ToBigInt("fd00:ec2::254"), // AWS IPv6 IMDS
]);

// IPv4-mapped IPv6 prefix: ::ffff:0:0/96
// Top 96 bits = 0x00000000000000000000ffff
const IPV4_MAPPED_TOP_96 = 0x00000000000000000000ffffn;

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
    const mask = prefix === 0 ? 0 : (~((1 << (32 - prefix)) - 1)) >>> 0;
    if ((n & mask) >>> 0 === (network & mask) >>> 0) return true;
  }
  return false;
}

function isBlockedIPv6(ip: string): boolean {
  if (!net.isIPv6(ip)) return false;

  // IPv4-mapped dotted form: ::ffff:192.168.1.1
  const ipv4DottedMapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (ipv4DottedMapped?.[1] !== undefined) {
    return isBlockedIPv4(ipv4DottedMapped[1]);
  }

  let n: bigint;
  try {
    n = ipv6ToBigInt(ip);
  } catch {
    return true; // cannot parse → block by default
  }

  if (BLOCKED_IPV6_EXACT.has(n)) return true;

  // IPv4-mapped hex form: ::ffff:c0a8:0101 = ::ffff:192.168.1.1
  // The top 96 bits of all IPv4-mapped addresses equal 0x00000000000000000000ffff
  if ((n >> 32n) === IPV4_MAPPED_TOP_96) {
    const ipv4Int = Number(n & 0xffffffffn);
    const ipv4 = [
      (ipv4Int >>> 24) & 0xff,
      (ipv4Int >>> 16) & 0xff,
      (ipv4Int >>> 8) & 0xff,
      ipv4Int & 0xff,
    ].join(".");
    return isBlockedIPv4(ipv4);
  }

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

/**
 * Validate the URL, resolve its hostname, and return the pinning info.
 *
 * For HTTPS: resolves all A/AAAA records, blocks if any is private/reserved,
 * returns the validated IP list for use as pinned connection targets.
 *
 * For HTTP localhost in dev mode: skips IP-range checks (loopback is trusted),
 * returns empty resolvedIps (caller must not pin, must not hit external network).
 */
export async function resolveUrlForPinning(
  rawUrl: string,
  opts: SsrfOptions = {},
): Promise<ResolvedUrl> {
  const { allowHttp = false, dnsResolver = systemDnsResolver } = opts;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError(`Invalid URL: ${rawUrl}`, "INVALID_URL");
  }

  // Embedded credentials are never allowed
  if (url.username !== "" || url.password !== "") {
    throw new SsrfError(
      "URLs with embedded credentials are not allowed",
      "EMBEDDED_CREDENTIALS",
    );
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new SsrfError(
      `Protocol not allowed: ${url.protocol}`,
      "PROTOCOL_NOT_ALLOWED",
    );
  }

  const isHttps = url.protocol === "https:";
  const defaultPort = isHttps ? 443 : 80;
  const port = url.port !== "" ? parseInt(url.port, 10) : defaultPort;

  if (url.protocol === "http:") {
    if (!allowHttp) {
      throw new SsrfError(
        "HTTP is not allowed in production. Use HTTPS.",
        "HTTPS_REQUIRED",
      );
    }
    // HTTP only allowed for localhost literals in dev/test mode
    const hostname = url.hostname.toLowerCase();
    const isLocalhostLiteral =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1";
    if (!isLocalhostLiteral) {
      throw new SsrfError(
        `HTTP is only allowed for localhost in development/test mode. Got: ${hostname}`,
        "HTTP_NON_LOCALHOST",
      );
    }
    // Localhost literals are trusted; no IP pinning needed.
    return { hostname, port, isHttps: false, resolvedIps: [] };
  }

  // HTTPS: resolve all A/AAAA records and validate every IP
  const resolvedIps = await resolveAndCheckHost(url.hostname, dnsResolver);
  return { hostname: url.hostname, port, isHttps: true, resolvedIps };
}

/** Resolve all A/AAAA records for a hostname and reject if any is blocked. */
async function resolveAndCheckHost(
  hostname: string,
  dnsResolver: DnsResolver,
): Promise<string[]> {
  // IP literal — check directly, no DNS needed
  if (net.isIP(hostname) !== 0) {
    if (isBlockedIp(hostname)) {
      throw new SsrfError(`IP address is blocked: ${hostname}`, "BLOCKED_IP");
    }
    return [hostname];
  }

  let records: Awaited<ReturnType<DnsResolver["lookup"]>>;
  try {
    records = await dnsResolver.lookup(hostname);
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

  // ALL resolved addresses must be safe — if ANY is private, reject.
  // This prevents DNS rebinding through multi-A-record tricks.
  for (const record of records) {
    if (isBlockedIp(record.address)) {
      throw new SsrfError(
        `Resolved address is blocked: ${record.address} (for ${hostname})`,
        "BLOCKED_RESOLVED_IP",
      );
    }
  }

  return records.map((r) => r.address);
}

/** Validate a URL without returning pinning info (convenience wrapper). */
export async function validateUrl(
  rawUrl: string,
  opts: SsrfOptions = {},
): Promise<void> {
  await resolveUrlForPinning(rawUrl, opts);
}

/**
 * Validate a redirect target.
 *
 * In addition to the standard SSRF checks, an HTTPS→HTTP downgrade is always
 * rejected regardless of the allowHttp option.
 */
export async function validateRedirect(
  location: string,
  opts: SsrfOptions = {},
  originalProtocol?: string,
): Promise<void> {
  // Explicit protocol-downgrade guard
  if (originalProtocol === "https:") {
    let target: URL;
    try {
      target = new URL(location);
    } catch {
      throw new SsrfError(`Invalid redirect URL: ${location}`, "INVALID_URL");
    }
    if (target.protocol === "http:") {
      throw new SsrfError(
        "Protocol downgrade (HTTPS → HTTP) is not allowed",
        "PROTOCOL_DOWNGRADE",
      );
    }
  }
  await validateUrl(location, opts);
}

export { MAX_REDIRECTS_DEFAULT };
