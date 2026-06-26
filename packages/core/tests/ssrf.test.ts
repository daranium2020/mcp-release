import { describe, it, expect } from "vitest";
import { isBlockedIp, validateUrl, SsrfError } from "../src/ssrf.js";

describe("isBlockedIp", () => {
  it("blocks loopback IPv4", () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true);
    expect(isBlockedIp("127.255.255.255")).toBe(true);
  });

  it("blocks private ranges", () => {
    expect(isBlockedIp("10.0.0.1")).toBe(true);
    expect(isBlockedIp("172.16.0.1")).toBe(true);
    expect(isBlockedIp("172.31.255.255")).toBe(true);
    expect(isBlockedIp("192.168.1.1")).toBe(true);
  });

  it("blocks link-local", () => {
    expect(isBlockedIp("169.254.0.1")).toBe(true);
    expect(isBlockedIp("169.254.169.254")).toBe(true); // AWS IMDS
  });

  it("blocks carrier-grade NAT", () => {
    expect(isBlockedIp("100.64.0.1")).toBe(true);
    expect(isBlockedIp("100.127.255.255")).toBe(true);
  });

  it("blocks multicast", () => {
    expect(isBlockedIp("224.0.0.1")).toBe(true);
    expect(isBlockedIp("239.255.255.255")).toBe(true);
  });

  it("allows public IPs", () => {
    expect(isBlockedIp("8.8.8.8")).toBe(false);
    expect(isBlockedIp("1.1.1.1")).toBe(false);
    expect(isBlockedIp("93.184.216.34")).toBe(false);
  });

  it("blocks IPv6 loopback", () => {
    expect(isBlockedIp("::1")).toBe(true);
  });

  it("blocks IPv6 link-local", () => {
    expect(isBlockedIp("fe80::1")).toBe(true);
  });

  it("blocks IPv6 unique-local", () => {
    expect(isBlockedIp("fc00::1")).toBe(true);
    expect(isBlockedIp("fd00::1")).toBe(true);
  });

  it("blocks IPv4-mapped IPv6 private addresses", () => {
    expect(isBlockedIp("::ffff:192.168.1.1")).toBe(true);
    expect(isBlockedIp("::ffff:10.0.0.1")).toBe(true);
  });
});

describe("validateUrl", () => {
  it("rejects HTTP in production mode", async () => {
    await expect(
      validateUrl("http://example.com/mcp", { allowHttp: false }),
    ).rejects.toThrow(SsrfError);
  });

  it("allows HTTPS", async () => {
    // example.com is a public IP — will pass SSRF check
    await expect(
      validateUrl("https://example.com/mcp"),
    ).resolves.toBeUndefined();
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

  it("rejects unsupported protocols", async () => {
    await expect(validateUrl("ftp://example.com/mcp")).rejects.toThrow(
      SsrfError,
    );
  });
});
