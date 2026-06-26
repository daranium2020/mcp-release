import { describe, it, expect, vi } from "vitest";
import { isBlockedIp, validateUrl, validateRedirect, resolveUrlForPinning, SsrfError } from "../src/ssrf.js";
import type { DnsResolver } from "../src/dns.js";

// ---------------------------------------------------------------------------
// IP-range blocking
// ---------------------------------------------------------------------------

describe("isBlockedIp — public addresses allowed", () => {
  it("allows public IPv4", () => {
    expect(isBlockedIp("8.8.8.8")).toBe(false);
    expect(isBlockedIp("1.1.1.1")).toBe(false);
    expect(isBlockedIp("93.184.216.34")).toBe(false);
  });

  it("allows public IPv6", () => {
    expect(isBlockedIp("2001:4860:4860::8888")).toBe(false); // Google DNS
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false); // Cloudflare DNS
    expect(isBlockedIp("2001:db8::1")).toBe(true); // documentation range — blocked
  });
});

describe("isBlockedIp — IPv4 private/special", () => {
  it("blocks loopback (127.0.0.0/8)", () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true);
    expect(isBlockedIp("127.255.255.255")).toBe(true);
  });

  it("blocks RFC 1918 private ranges", () => {
    expect(isBlockedIp("10.0.0.1")).toBe(true);
    expect(isBlockedIp("172.16.0.1")).toBe(true);
    expect(isBlockedIp("172.31.255.255")).toBe(true);
    expect(isBlockedIp("192.168.1.1")).toBe(true);
  });

  it("blocks link-local (169.254.0.0/16)", () => {
    expect(isBlockedIp("169.254.0.1")).toBe(true);
    expect(isBlockedIp("169.254.169.254")).toBe(true); // IMDS
  });

  it("blocks cloud metadata endpoint (169.254.169.254)", () => {
    expect(isBlockedIp("169.254.169.254")).toBe(true);
  });

  it("blocks carrier-grade NAT (100.64.0.0/10)", () => {
    expect(isBlockedIp("100.64.0.1")).toBe(true);
    expect(isBlockedIp("100.127.255.255")).toBe(true);
  });

  it("blocks multicast (224.0.0.0/4)", () => {
    expect(isBlockedIp("224.0.0.1")).toBe(true);
    expect(isBlockedIp("239.255.255.255")).toBe(true);
  });

  it("blocks documentation ranges (RFC 5737)", () => {
    expect(isBlockedIp("192.0.2.1")).toBe(true);
    expect(isBlockedIp("198.51.100.1")).toBe(true);
    expect(isBlockedIp("203.0.113.1")).toBe(true);
  });
});

describe("isBlockedIp — IPv6 special", () => {
  it("blocks loopback (::1)", () => {
    expect(isBlockedIp("::1")).toBe(true);
  });

  it("blocks link-local (fe80::/10)", () => {
    expect(isBlockedIp("fe80::1")).toBe(true);
  });

  it("blocks unique-local (fc00::/7)", () => {
    expect(isBlockedIp("fc00::1")).toBe(true);
    expect(isBlockedIp("fd00::1")).toBe(true);
  });

  it("blocks multicast (ff00::/8)", () => {
    expect(isBlockedIp("ff00::1")).toBe(true);
    expect(isBlockedIp("ff02::1")).toBe(true);
  });

  it("blocks AWS IPv6 IMDS (fd00:ec2::254)", () => {
    expect(isBlockedIp("fd00:ec2::254")).toBe(true);
  });

  it("blocks IPv4-mapped private — dotted form (::ffff:192.168.1.1)", () => {
    expect(isBlockedIp("::ffff:192.168.1.1")).toBe(true);
    expect(isBlockedIp("::ffff:10.0.0.1")).toBe(true);
    expect(isBlockedIp("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedIp("::ffff:169.254.169.254")).toBe(true);
  });

  it("blocks IPv4-mapped private — hex form (::ffff:c0a8:0101)", () => {
    expect(isBlockedIp("::ffff:c0a8:0101")).toBe(true);  // 192.168.1.1
    expect(isBlockedIp("::ffff:7f00:1")).toBe(true);      // 127.0.0.1
    expect(isBlockedIp("::ffff:a9fe:a9fe")).toBe(true);   // 169.254.169.254
  });

  it("allows IPv4-mapped public addresses", () => {
    expect(isBlockedIp("::ffff:8.8.8.8")).toBe(false);
    expect(isBlockedIp("::ffff:0808:0808")).toBe(false); // hex form of 8.8.8.8
  });
});

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

describe("validateUrl", () => {
  it("rejects HTTP in production mode", async () => {
    await expect(
      validateUrl("http://example.com/mcp", { allowHttp: false }),
    ).rejects.toThrow(SsrfError);
  });

  it("allows HTTPS to public hostname", async () => {
    await expect(validateUrl("https://example.com/mcp")).resolves.toBeUndefined();
  });

  it("allows HTTP for localhost when allowHttp is true", async () => {
    await expect(
      validateUrl("http://localhost:3000/mcp", { allowHttp: true }),
    ).resolves.toBeUndefined();
  });

  it("allows HTTP for 127.0.0.1 when allowHttp is true", async () => {
    await expect(
      validateUrl("http://127.0.0.1:3000/mcp", { allowHttp: true }),
    ).resolves.toBeUndefined();
  });

  it("rejects HTTP for non-localhost even with allowHttp", async () => {
    await expect(
      validateUrl("http://example.com/mcp", { allowHttp: true }),
    ).rejects.toThrow(SsrfError);
  });

  it("rejects invalid URLs", async () => {
    await expect(validateUrl("not-a-url")).rejects.toThrow(SsrfError);
  });

  it("rejects unsupported protocols (ftp)", async () => {
    await expect(validateUrl("ftp://example.com/mcp")).rejects.toThrow(SsrfError);
  });

  it("blocks embedded credentials in URL", async () => {
    const err = await validateUrl("https://user:pass@example.com/mcp").catch((e) => e);
    expect(err).toBeInstanceOf(SsrfError);
    expect((err as SsrfError).reason).toBe("EMBEDDED_CREDENTIALS");
  });

  it("blocks embedded username only", async () => {
    const err = await validateUrl("https://user@example.com/mcp").catch((e) => e);
    expect(err).toBeInstanceOf(SsrfError);
    expect((err as SsrfError).reason).toBe("EMBEDDED_CREDENTIALS");
  });
});

// ---------------------------------------------------------------------------
// Injectable DNS — deterministic multi-address tests
// ---------------------------------------------------------------------------

describe("resolveUrlForPinning — injectable DNS", () => {
  function makeMockDns(addresses: Array<{ address: string; family: 4 | 6 }>): DnsResolver {
    return { lookup: vi.fn().mockResolvedValue(addresses) };
  }

  it("allows hostname resolving only to public addresses", async () => {
    const resolver = makeMockDns([
      { address: "1.2.3.4", family: 4 },
      { address: "2001:4860:4860::8888", family: 6 },
    ]);
    await expect(
      resolveUrlForPinning("https://example.com/mcp", { dnsResolver: resolver }),
    ).resolves.toMatchObject({ resolvedIps: ["1.2.3.4", "2001:4860:4860::8888"] });
    expect(resolver.lookup).toHaveBeenCalledOnce();
  });

  it("blocks hostname resolving to ANY private address", async () => {
    const resolver = makeMockDns([
      { address: "1.2.3.4", family: 4 },      // public
      { address: "192.168.1.1", family: 4 },   // private — must block
    ]);
    const err = await resolveUrlForPinning("https://example.com/mcp", {
      dnsResolver: resolver,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SsrfError);
    expect((err as SsrfError).reason).toBe("BLOCKED_RESOLVED_IP");
  });

  it("blocks hostname resolving only to private addresses", async () => {
    const resolver = makeMockDns([{ address: "10.0.0.1", family: 4 }]);
    const err = await resolveUrlForPinning("https://internal.local/mcp", {
      dnsResolver: resolver,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SsrfError);
    expect((err as SsrfError).reason).toBe("BLOCKED_RESOLVED_IP");
  });

  it("resolver is called exactly once — second resolution cannot rebind the pin", async () => {
    const resolver = makeMockDns([{ address: "1.2.3.4", family: 4 }]);
    await resolveUrlForPinning("https://example.com/mcp", { dnsResolver: resolver });
    // Only one lookup should occur; subsequent connection uses the pinned IP
    expect(resolver.lookup).toHaveBeenCalledOnce();
  });

  it("blocks initial-public-then-private rebinding simulation", async () => {
    // Simulate a DNS resolver that returns private IPs on the second call
    // (DNS rebinding attempt). The second call must never happen because
    // we pin to the result of the first call and stop resolving.
    const lookup = vi
      .fn()
      .mockResolvedValueOnce([{ address: "1.2.3.4", family: 4 }])
      .mockResolvedValueOnce([{ address: "192.168.1.1", family: 4 }]);
    const resolver: DnsResolver = { lookup };

    const result = await resolveUrlForPinning("https://example.com/mcp", {
      dnsResolver: resolver,
    });

    // First call returned public IP → validation passed, IP pinned
    expect(result.resolvedIps).toContain("1.2.3.4");
    // Resolver was called exactly once — no opportunity for rebinding
    expect(lookup).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Redirect validation
// ---------------------------------------------------------------------------

describe("validateRedirect", () => {
  it("blocks redirect to private IP address", async () => {
    const err = await validateRedirect("https://192.168.1.1/mcp").catch((e) => e);
    expect(err).toBeInstanceOf(SsrfError);
    expect((err as SsrfError).reason).toBe("BLOCKED_IP");
  });

  it("blocks redirect to link-local metadata endpoint", async () => {
    const err = await validateRedirect("https://169.254.169.254/mcp").catch((e) => e);
    expect(err).toBeInstanceOf(SsrfError);
  });

  it("blocks HTTPS → HTTP protocol downgrade", async () => {
    const err = await validateRedirect(
      "http://example.com/mcp",
      {},
      "https:",
    ).catch((e) => e);
    expect(err).toBeInstanceOf(SsrfError);
    expect((err as SsrfError).reason).toBe("PROTOCOL_DOWNGRADE");
  });

  it("allows HTTP → HTTP (no downgrade)", async () => {
    // HTTP to localhost is allowed in dev mode; no downgrade from HTTPS
    await expect(
      validateRedirect("http://localhost/mcp", { allowHttp: true }, "http:"),
    ).resolves.toBeUndefined();
  });

  it("blocks HTTPS → HTTP even with allowHttp:true", async () => {
    const err = await validateRedirect(
      "http://localhost/mcp",
      { allowHttp: true },
      "https:",
    ).catch((e) => e);
    expect(err).toBeInstanceOf(SsrfError);
    expect((err as SsrfError).reason).toBe("PROTOCOL_DOWNGRADE");
  });
});
