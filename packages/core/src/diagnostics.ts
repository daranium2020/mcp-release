import type { TransportError } from "./transport.js";

/** Fixed-schema record emitted on transport failure. Contains no secrets. */
export type TransportDiagnostic = {
  /** Logical stage where the failure occurred. */
  phase: string;
  /** Top-level error class name. */
  errorName: string;
  /** Top-level error code (e.g. undici UND_ERR_*), if present. */
  errorCode: string | null;
  /** Name of the deepest extractable cause error. */
  causeName: string | null;
  /** OS or protocol error code from the cause (e.g. ENETUNREACH, ERR_TLS_*). */
  causeCode: string | null;
  /** OS syscall from the cause (e.g. "connect"), if present. */
  causeSyscall: string | null;
  /** IP address family that was pinned at connection time: 4, 6, or null if unknown. */
  selectedIpFamily: 4 | 6 | null;
  /**
   * Short diagnostic string built from enumerated constants only (code + syscall),
   * or "unclassified" when no code is available. Never passes through raw message
   * text — no IPs, hostnames, paths, or credentials can appear here.
   */
  safeMessage: string;
};

// code can be string (Node/OS errors) or number (StreamableHTTPError HTTP status).
type NodeError = Error & { code?: string | number; syscall?: string };

/**
 * Build a safe message from enumerated constants (code + syscall) when available.
 * Falls back to the literal "unclassified" — never passes through raw message text.
 */
function buildSafeMessage(
  causeCode: string | null,
  causeSyscall: string | null,
): string {
  if (causeCode !== null) {
    const parts = [causeCode];
    if (causeSyscall !== null) parts.push(`syscall:${causeSyscall}`);
    return parts.join(" ");
  }
  return "unclassified";
}

/**
 * Walk the cause chain up to maxDepth levels.
 * AggregateError: its first error is treated as the representative cause.
 * Returns all encountered Error instances (closest first).
 */
function collectCauseCandidates(root: unknown, maxDepth = 3): Error[] {
  const candidates: Error[] = [];
  let cur: unknown = root;
  for (let i = 0; i < maxDepth; i++) {
    if (!(cur instanceof Error)) break;
    candidates.push(cur);
    if (cur instanceof AggregateError && cur.errors.length > 0) {
      const first = cur.errors[0];
      if (first instanceof Error) candidates.push(first);
      break;
    }
    cur = (cur as NodeError & { cause?: unknown }).cause;
  }
  return candidates;
}

function extractCauseInfoFromCandidates(candidates: Error[]): {
  causeName: string | null;
  causeCode: string | null;
  causeSyscall: string | null;
} {
  // Prefer the first candidate that carries a code or syscall — those are from the OS/TLS layer.
  // Normalize code to string: StreamableHTTPError.code is a numeric HTTP status.
  for (const c of candidates) {
    const rawCode = (c as NodeError).code;
    const code = rawCode != null ? String(rawCode) : null;
    const syscall = (c as NodeError).syscall ?? null;
    if (code !== null || syscall !== null) {
      return { causeName: c.name, causeCode: code, causeSyscall: syscall };
    }
  }
  // Fall back to the first cause with no code/syscall.
  const first = candidates[0];
  return first
    ? { causeName: first.name, causeCode: null, causeSyscall: null }
    : { causeName: null, causeCode: null, causeSyscall: null };
}

/**
 * Build a TransportDiagnostic from a TransportError.
 *
 * Safe to log verbatim: the output schema contains only enumerated constants,
 * numeric family identifiers, and a safe message — never IPs, URLs, hostnames,
 * paths, credentials, or stack traces.
 */
export function describeTransportError(
  err: TransportError,
  phase: string,
): TransportDiagnostic {
  const rawErrorCode = (err as NodeError).code;
  const errorCode = rawErrorCode != null ? String(rawErrorCode) : null;
  const causeCandidates = collectCauseCandidates(err.cause);
  const { causeName, causeCode, causeSyscall } = extractCauseInfoFromCandidates(causeCandidates);
  const selectedIpFamily = err.selectedIpFamily ?? null;
  const safeMessage = buildSafeMessage(causeCode ?? errorCode, causeSyscall);

  return {
    phase,
    errorName: err.name,
    errorCode,
    causeName,
    causeCode,
    causeSyscall,
    selectedIpFamily,
    safeMessage,
  };
}
