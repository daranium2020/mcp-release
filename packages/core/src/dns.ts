import dns from "node:dns/promises";
import type { LookupAddress } from "node:dns";

export type DnsRecord = {
  address: string;
  family: 4 | 6;
};

/**
 * Injectable DNS resolver interface.
 * The production implementation calls the system resolver.
 * Tests inject a deterministic mock to cover multi-address and
 * DNS-rebinding scenarios without touching the network.
 */
export type DnsResolver = {
  lookup(hostname: string): Promise<DnsRecord[]>;
};

export const systemDnsResolver: DnsResolver = {
  async lookup(hostname: string): Promise<DnsRecord[]> {
    const records: LookupAddress[] = await dns.lookup(hostname, { all: true });
    return records.map((r) => ({
      address: r.address,
      family: r.family as 4 | 6,
    }));
  },
};
