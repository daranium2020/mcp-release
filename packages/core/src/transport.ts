/**
 * Transport adapter for MCP Streamable HTTP.
 *
 * SECURITY LIMITATION (DNS pinning): The MCP SDK's StreamableHTTPClientTransport
 * does not allow injecting a pre-resolved IP address while preserving the original
 * hostname for TLS/SNI. This adapter performs preflight DNS validation and blocks
 * known-bad destinations before connecting. However, a TOCTOU window exists between
 * our DNS check and the SDK's own DNS resolution. Full DNS pinning (connecting to
 * the pre-resolved IP with SNI set to the original hostname) is tracked as a
 * next-milestone security task.
 *
 * Mitigations in place:
 * - All A/AAAA records are checked before connection.
 * - Every redirect destination is re-validated.
 * - Short connection timeouts limit the exploitation window.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Implementation, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { redactErrorMessage, redactUrl } from "./redact.js";
import {
  MAX_REDIRECTS_DEFAULT,
  SsrfError,
  validateRedirect,
  validateUrl,
  type SsrfOptions,
} from "./ssrf.js";

export type ConnectOptions = {
  timeoutMs?: number;
  maxRedirects?: number;
  ssrf?: SsrfOptions;
};

export type ConnectResult = {
  client: Client;
  transport: Transport;
  protocolVersion: string;
  serverInfo: { name?: string; version?: string } | null;
  durationMs: number;
  /** null when the SDK does not expose raw HTTP status */
  httpStatus: number | null;
  redirectCount: number;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export class TransportError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TransportError";
  }
}

export async function connectToMcpServer(
  serverUrl: string,
  opts: ConnectOptions = {},
): Promise<ConnectResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS_DEFAULT;
  const ssrfOpts = opts.ssrf ?? {};

  // Preflight SSRF check
  try {
    await validateUrl(serverUrl, ssrfOpts);
  } catch (err) {
    if (err instanceof SsrfError) {
      throw new TransportError(
        `SSRF validation failed: ${err.message}`,
        err,
      );
    }
    throw err;
  }

  let redirectCount = 0;

  const fetchWithGuard: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;

    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), timeoutMs);

    // Merge our timeout signal with any signal the transport passes (e.g. its
    // own abort controller for session teardown). AbortSignal.any() fires as
    // soon as any constituent signal fires — available in Node.js 20+.
    const existingSignal = init?.signal instanceof AbortSignal ? init.signal : undefined;
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
      response = await fetch(url, fetchInit);
    } finally {
      clearTimeout(timer);
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
      const resolved = new URL(location, url).toString();

      try {
        await validateRedirect(resolved, ssrfOpts);
      } catch (err) {
        if (err instanceof SsrfError) {
          throw new TransportError(
            `Redirect destination blocked: ${redactUrl(resolved)} — ${err.message}`,
            err,
          );
        }
        throw err;
      }

      // Drop auth headers when crossing origins
      const originalOrigin = new URL(url).origin;
      const redirectOrigin = new URL(resolved).origin;
      let redirectInit: RequestInit = { ...init, redirect: "manual", signal: mergedSignal };
      if (originalOrigin !== redirectOrigin) {
        const existingHeaders = redirectInit.headers;
        const safeHeaders: Record<string, string> = {};
        if (existingHeaders && typeof existingHeaders === "object" && !Array.isArray(existingHeaders)) {
          const entries =
            existingHeaders instanceof Headers
              ? [...existingHeaders.entries()]
              : Object.entries(existingHeaders as Record<string, string>);
          for (const [k, v] of entries) {
            const lower = k.toLowerCase();
            if (lower !== "authorization" && lower !== "x-api-key") {
              safeHeaders[k] = v;
            }
          }
        }
        redirectInit = { ...redirectInit, headers: safeHeaders };
      }

      return fetchWithGuard(resolved, redirectInit);
    }

    // Enforce response size limit
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

  const startMs = Date.now();

  const url = new URL(serverUrl);
  const transport = new StreamableHTTPClientTransport(url, {
    fetch: fetchWithGuard,
  });

  const client = new Client({
    name: "mcp-launch-checker",
    version: "0.0.1",
  });

  const connectPromise = client.connect(
    // SDK type has sessionId: string | undefined, but Transport interface expects string.
    // This is an SDK internal type inconsistency; the cast is safe at runtime.
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
    const info = client.getServerVersion();
    if (info) {
      protocolVersion = info.version ?? "unknown";
      serverInfo = {
        name: (info as Implementation & { name?: string }).name,
        version: info.version,
      };
    }
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const msg = redactErrorMessage(err);
    if (err instanceof TransportError) {
      throw err;
    }
    throw new TransportError(
      `Connection failed after ${durationMs}ms: ${msg}`,
      err,
    );
  }

  const durationMs = Date.now() - startMs;

  return {
    client,
    transport: transport as unknown as Transport,
    protocolVersion,
    serverInfo,
    durationMs,
    httpStatus: null,
    redirectCount,
  };
}

export async function listTools(client: Client): Promise<Tool[]> {
  const result = await client.listTools();
  return result.tools;
}
