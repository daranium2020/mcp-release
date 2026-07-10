/**
 * Transport adapter for MCP Streamable HTTP.
 *
 * DNS PINNING:
 * A custom undici Agent is used for HTTPS connections. The Agent's connector
 * function routes every outgoing TCP/TLS socket to the IP address that was
 * pre-resolved and SSRF-validated before the MCP Client.connect() call. This
 * closes the TOCTOU window between preflight DNS validation and the SDK's own
 * DNS resolution.
 *
 * - For the initial hostname: the pre-validated IP is pinned; no further DNS
 *   resolution occurs for that origin.
 * - For cross-origin redirect targets: DNS is resolved and SSRF-checked inside
 *   the connector, so every TCP connection uses a freshly validated address.
 * - TLS certificate verification is always enforced (rejectUnauthorized: true).
 * - The original hostname is passed as SNI for correct certificate validation.
 *
 * For HTTP localhost in development mode, no pinning is applied (the address
 * is a trusted loopback literal, not an externally-controlled name).
 *
 * REMAINING LIMITATION:
 * Redirect targets have a narrow TOCTOU between the pre-connect
 * validateRedirect() call and the in-connector DNS resolution. Both checks use
 * the injected DnsResolver so test coverage is complete; the practical window
 * is milliseconds. Full pre-resolution for every redirect target is tracked as
 * a future improvement.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Implementation, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import tls from "node:tls";
import net from "node:net";
import { fetch as undiciFetch, Agent } from "undici";
import type { buildConnector } from "undici";
import { redactErrorMessage, redactUrl } from "./redact.js";
import {
  MAX_REDIRECTS_DEFAULT,
  SsrfError,
  validateRedirect,
  resolveUrlForPinning,
  type SsrfOptions,
} from "./ssrf.js";

export type ConnectOptions = {
  timeoutMs?: number;
  maxRedirects?: number;
  ssrf?: SsrfOptions;
  /**
   * Additional HTTP request headers sent with every MCP request.
   * Used by the CLI and GitHub Action for authentication (Authorization,
   * X-API-Key, etc.). The web API never sets this.
   *
   * Sensitive headers are dropped on cross-origin redirects by the existing
   * redirect-handling logic in fetchChain.
   */
  requestHeaders?: Record<string, string>;
};

export type ConnectResult = {
  client: Client;
  transport: Transport;
  protocolVersion: string;
  serverInfo: { name?: string; version?: string } | null;
  durationMs: number;
  /** null — the SDK does not expose the raw HTTP status */
  httpStatus: number | null;
  redirectCount: number;
  /** Release the underlying undici Agent and all pooled connections. */
  disposeConnection: () => Promise<void>;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_HEADER_COUNT = 200;

export class TransportError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
    /** IP address family that was pinned when the error occurred (4, 6, or null). */
    public readonly selectedIpFamily?: 4 | 6 | null,
  ) {
    super(message);
    this.name = "TransportError";
  }
}

/**
 * Resolve a connector port string to a validated integer.
 *
 * WHATWG URL omits the port for HTTPS (443) and HTTP (80) defaults — both
 * `https://example.com/mcp` and `https://example.com:443/mcp` produce an
 * empty string from URL.port. Passing that empty string to parseInt() returns
 * NaN, which Node.js rejects with RangeError: ERR_SOCKET_BAD_PORT.
 *
 * Rules:
 *   - Empty string → protocol default (443 for HTTPS, 80 for HTTP).
 *   - Non-empty string → must be decimal digits only; must be 1–65535.
 *   - Anything else → throws RangeError (caller must call callback(err, null)).
 */
export function resolveConnectorPort(portStr: string, isHttps: boolean): number {
  if (portStr === "") {
    return isHttps ? 443 : 80;
  }
  if (!/^\d+$/.test(portStr)) {
    throw new RangeError(`Invalid port value: "${portStr}"`);
  }
  const p = Number(portStr);
  if (p === 0 || p > 65535) {
    throw new RangeError(`Port ${p} is out of the valid range 1–65535`);
  }
  return p;
}

/**
 * Build an undici connector that:
 *  - For `pinnedHostname`: always routes to `pinnedIp` (pre-validated, no TOCTOU).
 *  - For any other hostname (cross-origin redirect target): resolves DNS inline
 *    through our SSRF-checking resolver and connects to the first valid IP.
 */
function createPinnedConnector(
  pinnedHostname: string,
  pinnedIp: string,
  ssrfOpts: SsrfOptions,
): buildConnector.connector {
  const doConnect = (
    host: string,
    port: number,
    servername: string,
    isHttps: boolean,
    callback: buildConnector.Callback,
  ): void => {
    if (isHttps) {
      const socket = tls.connect({
        host,
        port,
        servername,
        rejectUnauthorized: true, // NEVER disable TLS verification
      });
      socket.once("secureConnect", () => callback(null, socket));
      socket.once("error", (err) => callback(err, null));
    } else {
      const socket = net.createConnection({ host, port });
      socket.once("connect", () => callback(null, socket));
      socket.once("error", (err) => callback(err, null));
    }
  };

  return (opts: buildConnector.Options, callback: buildConnector.Callback) => {
    const isHttps = opts.protocol === "https:";
    const sni = opts.servername ?? opts.hostname;

    let port: number;
    try {
      port = resolveConnectorPort(opts.port, isHttps);
    } catch (err) {
      callback(err instanceof Error ? err : new Error(String(err)), null);
      return;
    }

    if (opts.hostname === pinnedHostname) {
      // Initial hostname — use pre-validated pinned IP, no additional DNS call
      doConnect(pinnedIp, port, sni, isHttps, callback);
      return;
    }

    // Cross-origin redirect target — resolve and validate inline.
    // Omit the port component when empty so new URL() inside resolveUrlForPinning
    // does not see a trailing colon (which would be a parse error).
    const probeUrl = opts.port
      ? `${opts.protocol}//${opts.hostname}:${opts.port}`
      : `${opts.protocol}//${opts.hostname}`;
    resolveUrlForPinning(probeUrl, ssrfOpts)
      .then((result) => {
        const ip = result.resolvedIps[0];
        if (!ip) {
          callback(
            new Error(`No valid IP resolved for ${opts.hostname}`),
            null,
          );
          return;
        }
        doConnect(ip, port, sni, isHttps, callback);
      })
      .catch((err: unknown) => {
        callback(err instanceof Error ? err : new Error(String(err)), null);
      });
  };
}

/**
 * Wrap an undici Agent in a fetch-compatible function.
 *
 * undici.RequestInit includes `dispatcher?: Dispatcher`, which is not in the
 * global RequestInit. The casts are safe: in Node.js 20+ undici.Response is
 * identical to globalThis.Response (same underlying implementation).
 */
function makeFetchWithAgent(agent: Agent): typeof globalThis.fetch {
  return (input, init) => {
    // undici.RequestInit adds `dispatcher`; undici.Response === globalThis.Response in Node 20+.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const undiciInit = { ...(init as any), dispatcher: agent };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return undiciFetch(input as any, undiciInit) as unknown as Promise<Response>;
  };
}

export async function connectToMcpServer(
  serverUrl: string,
  opts: ConnectOptions = {},
): Promise<ConnectResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS_DEFAULT;
  const ssrfOpts = opts.ssrf ?? {};
  const requestHeaders = opts.requestHeaders ?? {};

  // Resolve DNS and validate URL — returns pinned IPs for HTTPS
  let resolvedUrl: Awaited<ReturnType<typeof resolveUrlForPinning>>;
  try {
    resolvedUrl = await resolveUrlForPinning(serverUrl, ssrfOpts);
  } catch (err) {
    if (err instanceof SsrfError) {
      throw new TransportError(`SSRF validation failed: ${err.message}`, err);
    }
    throw err;
  }

  // Create pinned agent for HTTPS (closes TOCTOU), or null for HTTP localhost
  let agent: Agent | null = null;
  let baseFetch: typeof globalThis.fetch;
  let pinnedIpFamily: 4 | 6 | null = null;

  if (resolvedUrl.isHttps && resolvedUrl.resolvedIps.length > 0) {
    const pinnedIp = resolvedUrl.resolvedIps[0]!;
    const ipNum = net.isIP(pinnedIp);
    pinnedIpFamily = ipNum === 4 || ipNum === 6 ? ipNum : null;
    const connector = createPinnedConnector(
      resolvedUrl.hostname,
      pinnedIp,
      ssrfOpts,
    );
    agent = new Agent({ connect: connector });
    baseFetch = makeFetchWithAgent(agent);
  } else {
    // HTTP localhost in dev mode — use global fetch (socket goes to 127.0.0.1)
    baseFetch = fetch;
  }

  let redirectCount = 0;

  // Security-hardened fetch: timeout, redirect loop/downgrade detection,
  // response-size limit, header-count limit.
  //
  // visitedUrls is created fresh for each top-level SDK request so that the
  // same URL can be called multiple times (e.g., initialize then tools/list).
  // Redirect chains within a single request share the same Set to detect loops.
  const fetchChain = async (
    input: Parameters<typeof fetch>[0],
    rawInit: Parameters<typeof fetch>[1],
    chainVisited: Set<string>,
  ): Promise<Response> => {
    // Merge caller-supplied request headers (e.g., Authorization) into every
    // request. SDK protocol headers take precedence on any name conflict.
    // This merged init is also used for redirect init so that the existing
    // cross-origin header-stripping logic handles sensitive headers correctly.
    let init = rawInit;
    if (Object.keys(requestHeaders).length > 0) {
      const sdkHeaders = rawInit?.headers;
      const sdkRecord: Record<string, string> = {};
      if (sdkHeaders instanceof Headers) {
        sdkHeaders.forEach((v, k) => { sdkRecord[k] = v; });
      } else if (sdkHeaders && typeof sdkHeaders === "object" && !Array.isArray(sdkHeaders)) {
        Object.assign(sdkRecord, sdkHeaders as Record<string, string>);
      }
      init = {
        ...rawInit,
        headers: { ...requestHeaders, ...sdkRecord },
      };
    }

    const urlStr =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;

    // Redirect loop detection (within a single redirect chain)
    if (chainVisited.has(urlStr)) {
      throw new TransportError(
        `Redirect loop detected: already visited ${redactUrl(urlStr)}`,
      );
    }
    chainVisited.add(urlStr);

    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), timeoutMs);

    const existingSignal =
      init?.signal instanceof AbortSignal ? init.signal : undefined;
    const mergedSignal = existingSignal
      ? AbortSignal.any([timeoutController.signal, existingSignal])
      : timeoutController.signal;

    const fetchInit: RequestInit = {
      ...init,
      signal: mergedSignal,
      redirect: "manual",
    };

    let response: Response;
    try {
      response = await baseFetch(urlStr, fetchInit);
    } finally {
      clearTimeout(timer);
    }

    // Enforce maximum header count
    let headerCount = 0;
    response.headers.forEach(() => {
      headerCount++;
    });
    if (headerCount > MAX_HEADER_COUNT) {
      throw new TransportError(
        `Response has too many headers (${headerCount} > ${MAX_HEADER_COUNT})`,
      );
    }

    if (
      response.status >= 300 &&
      response.status < 400 &&
      response.headers.has("location")
    ) {
      if (redirectCount >= maxRedirects) {
        throw new TransportError(`Redirect limit (${maxRedirects}) exceeded`);
      }
      redirectCount++;
      const location = response.headers.get("location")!;
      const resolved = new URL(location, urlStr).toString();
      const originalProtocol = new URL(urlStr).protocol;

      try {
        await validateRedirect(resolved, ssrfOpts, originalProtocol);
      } catch (err) {
        if (err instanceof SsrfError) {
          if (err.reason === "PROTOCOL_DOWNGRADE") {
            throw new TransportError(
              `Protocol downgrade blocked: ${redactUrl(resolved)}`,
              err,
            );
          }
          throw new TransportError(
            `Redirect destination blocked: ${redactUrl(resolved)} — ${err.message}`,
            err,
          );
        }
        throw err;
      }

      // Drop sensitive headers when crossing origins
      const origOrigin = new URL(urlStr).origin;
      const destOrigin = new URL(resolved).origin;
      let redirectInit: RequestInit = {
        ...init,
        redirect: "manual",
        signal: mergedSignal,
      };
      if (origOrigin !== destOrigin) {
        const existingHdrs = redirectInit.headers;
        const safeHeaders: Record<string, string> = {};
        if (existingHdrs && typeof existingHdrs === "object" && !Array.isArray(existingHdrs)) {
          const entries =
            existingHdrs instanceof Headers
              ? [...existingHdrs.entries()]
              : Object.entries(existingHdrs as Record<string, string>);
          for (const [k, v] of entries) {
            const lower = k.toLowerCase();
            const isSensitive =
              lower === "authorization" ||
              lower === "x-api-key" ||
              lower === "cookie" ||
              lower === "proxy-authorization" ||
              lower === "x-auth-token" ||
              lower === "x-secret" ||
              lower === "x-token";
            if (!isSensitive) safeHeaders[k] = v;
          }
        }
        redirectInit = { ...redirectInit, headers: safeHeaders };
      }

      return fetchChain(resolved, redirectInit, chainVisited);
    }

    // Enforce response-size limit via Content-Length header
    const contentLength = response.headers.get("content-length");
    if (
      contentLength !== null &&
      parseInt(contentLength, 10) > MAX_RESPONSE_SIZE_BYTES
    ) {
      throw new TransportError(
        `Response size exceeds limit (${MAX_RESPONSE_SIZE_BYTES} bytes)`,
      );
    }

    return response;
  };

  // Each top-level SDK request starts a fresh per-chain visited set.
  const fetchWithGuard: typeof fetch = (input, init) =>
    fetchChain(input, init, new Set());

  const startMs = Date.now();
  const url = new URL(serverUrl);

  const transport = new StreamableHTTPClientTransport(url, {
    fetch: fetchWithGuard,
  });

  const mcpClient = new Client({
    name: "mcp-release-checker",
    version: "0.0.1",
  });

  const connectPromise = mcpClient.connect(
    // SDK type has sessionId: string | undefined; Transport interface expects string.
    // This cast resolves the internal type inconsistency; the runtime behaviour is correct.
    transport as unknown as Transport,
  );
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new TransportError("Connection timeout")),
      timeoutMs,
    ),
  );

  let protocolVersion = "unknown";
  let serverInfo: { name?: string; version?: string } | null = null;

  try {
    await Promise.race([connectPromise, timeoutPromise]);
    const info = mcpClient.getServerVersion();
    if (info) {
      protocolVersion = info.version ?? "unknown";
      serverInfo = {
        name: (info as Implementation & { name?: string }).name,
        version: info.version,
      };
    }
  } catch (err) {
    await agent?.destroy().catch(() => undefined);
    const durationMs = Date.now() - startMs;
    const msg = redactErrorMessage(err);
    if (err instanceof TransportError) throw err;
    throw new TransportError(
      `Connection failed after ${durationMs}ms: ${msg}`,
      err,
      pinnedIpFamily,
    );
  }

  const durationMs = Date.now() - startMs;

  return {
    client: mcpClient,
    transport: transport as unknown as Transport,
    protocolVersion,
    serverInfo,
    durationMs,
    httpStatus: null,
    redirectCount,
    disposeConnection: async () => {
      await agent?.destroy().catch(() => undefined);
    },
  };
}

export async function listTools(client: Client): Promise<Tool[]> {
  const result = await client.listTools();
  return result.tools;
}
