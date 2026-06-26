const REDACTED = "[REDACTED]";

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "x-api-key",
  "x-auth-token",
  "cookie",
  "set-cookie",
  "proxy-authorization",
  "x-secret",
  "x-token",
]);

// Matches bearer/token patterns in strings: Bearer <token>, token=<value>, key=<value>
const TOKEN_PATTERN =
  /\b(bearer\s+)[A-Za-z0-9\-._~+/]+=*|(\btoken[=:\s]+)[^\s&"']+|(\bkey[=:\s]+)[^\s&"']+|(\bsecret[=:\s]+)[^\s&"']+/gi;

export function redactHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    result[name] = SENSITIVE_HEADER_NAMES.has(name.toLowerCase())
      ? REDACTED
      : value;
  }
  return result;
}

export function redactUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const sensitiveKeys: string[] = [];
    for (const key of url.searchParams.keys()) {
      const lower = key.toLowerCase();
      if (
        lower.includes("token") ||
        lower.includes("key") ||
        lower.includes("secret") ||
        lower.includes("auth") ||
        lower.includes("password") ||
        lower.includes("pwd")
      ) {
        sensitiveKeys.push(key);
      }
    }
    if (sensitiveKeys.length === 0) return rawUrl;
    for (const key of sensitiveKeys) {
      url.searchParams.set(key, REDACTED);
    }
    // URLSearchParams encodes brackets; decode them back for the placeholder only
    return url.toString().replace(/%5BREDACTED%5D/gi, REDACTED);
  } catch {
    return rawUrl;
  }
}

export function redactString(input: string): string {
  return input.replace(TOKEN_PATTERN, (match, p1, p2, p3, p4) => {
    if (p1 !== undefined) return p1 + REDACTED;
    if (p2 !== undefined) return p2 + REDACTED;
    if (p3 !== undefined) return p3 + REDACTED;
    if (p4 !== undefined) return p4 + REDACTED;
    return match;
  });
}

export function redactErrorMessage(err: unknown): string {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err);
  return redactString(msg);
}
