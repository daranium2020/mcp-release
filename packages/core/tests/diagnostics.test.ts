import { describe, it, expect } from "vitest";
import { describeTransportError, type TransportDiagnostic } from "../src/diagnostics.js";
import { TransportError } from "../src/transport.js";
import { SsrfError } from "../src/ssrf.js";
import { runCheck } from "../src/check.js";

// ---------------------------------------------------------------------------
// Helpers: synthetic errors that mirror what undici / Node.js produces
// ---------------------------------------------------------------------------

function nodeError(
  message: string,
  code: string,
  syscall?: string,
): Error & { code: string; syscall?: string } {
  const err = new Error(message) as Error & { code: string; syscall?: string };
  err.code = code;
  if (syscall !== undefined) err.syscall = syscall;
  return err;
}

function fetchFailed(cause: unknown): TypeError {
  const err = new TypeError("fetch failed");
  (err as TypeError & { cause: unknown }).cause = cause;
  return err;
}

function transportError(
  message: string,
  cause?: unknown,
  family?: 4 | 6 | null,
): TransportError {
  return new TransportError(message, cause, family ?? null);
}

// ---------------------------------------------------------------------------
// 1. Cause chain extraction
// ---------------------------------------------------------------------------

describe("describeTransportError — cause extraction", () => {
  it("returns null cause fields when no cause is set", () => {
    const err = transportError("Connection failed");
    const d = describeTransportError(err, "transport_connect");
    expect(d.causeName).toBeNull();
    expect(d.causeCode).toBeNull();
    expect(d.causeSyscall).toBeNull();
  });

  it("extracts code and syscall from a one-level cause", () => {
    const cause = nodeError("connect ECONNREFUSED 127.0.0.1:80", "ECONNREFUSED", "connect");
    const err = transportError("Connection failed", cause);
    const d = describeTransportError(err, "transport_connect");
    expect(d.causeName).toBe("Error");
    expect(d.causeCode).toBe("ECONNREFUSED");
    expect(d.causeSyscall).toBe("connect");
  });

  it("extracts code and syscall from a two-level cause chain", () => {
    const leafCause = nodeError("connect ENETUNREACH 2a00::1:443", "ENETUNREACH", "connect");
    const midCause = fetchFailed(leafCause);
    const err = transportError("Connection failed", midCause);
    const d = describeTransportError(err, "transport_connect");
    expect(d.causeCode).toBe("ENETUNREACH");
    expect(d.causeSyscall).toBe("connect");
  });

  it("extracts code from AggregateError.errors[0]", () => {
    const socketErr = nodeError("connect ECONNREFUSED", "ECONNREFUSED", "connect");
    const aggErr = new AggregateError([socketErr], "All connections failed");
    const err = transportError("Connection failed", aggErr);
    const d = describeTransportError(err, "transport_connect");
    expect(d.causeCode).toBe("ECONNREFUSED");
    expect(d.causeSyscall).toBe("connect");
  });

  it("extracts code from AggregateError nested inside a TypeError cause chain", () => {
    const socketErr = nodeError("connect ENETUNREACH", "ENETUNREACH", "connect");
    const aggErr = new AggregateError([socketErr], "All connections failed");
    const typeErr = fetchFailed(aggErr);
    const err = transportError("Connection failed", typeErr);
    const d = describeTransportError(err, "transport_connect");
    expect(d.causeCode).toBe("ENETUNREACH");
  });

  it("falls back to first cause name when no code is present", () => {
    const plainCause = new TypeError("Something unexpected");
    const err = transportError("Connection failed", plainCause);
    const d = describeTransportError(err, "transport_connect");
    expect(d.causeName).toBe("TypeError");
    expect(d.causeCode).toBeNull();
    expect(d.causeSyscall).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Error codes — OS and TLS
// ---------------------------------------------------------------------------

describe("describeTransportError — error codes", () => {
  it("captures ENETUNREACH", () => {
    const cause = nodeError("connect ENETUNREACH 2a00::1:443", "ENETUNREACH", "connect");
    const d = describeTransportError(transportError("failed", fetchFailed(cause)), "transport_connect");
    expect(d.causeCode).toBe("ENETUNREACH");
    expect(d.causeSyscall).toBe("connect");
  });

  it("captures ECONNREFUSED", () => {
    const cause = nodeError("connect ECONNREFUSED 127.0.0.1:9", "ECONNREFUSED", "connect");
    const d = describeTransportError(transportError("failed", cause), "transport_connect");
    expect(d.causeCode).toBe("ECONNREFUSED");
  });

  it("captures ETIMEDOUT", () => {
    const cause = nodeError("connect ETIMEDOUT 10.0.0.1:443", "ETIMEDOUT", "connect");
    const d = describeTransportError(transportError("failed", cause), "transport_connect");
    expect(d.causeCode).toBe("ETIMEDOUT");
  });

  it("captures ERR_TLS_CERT_ALTNAME_INVALID", () => {
    const cause = new Error(
      "Hostname/IP does not match certificate's altnames: Host: api.secret.example.com. is not in the cert's altnames: DNS:*.other.com",
    );
    (cause as Error & { code: string }).code = "ERR_TLS_CERT_ALTNAME_INVALID";
    const d = describeTransportError(transportError("failed", cause), "transport_connect");
    expect(d.causeCode).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
  });

  it("captures CERT_HAS_EXPIRED", () => {
    const cause = new Error("certificate has expired");
    (cause as Error & { code: string }).code = "CERT_HAS_EXPIRED";
    const d = describeTransportError(transportError("failed", cause), "transport_connect");
    expect(d.causeCode).toBe("CERT_HAS_EXPIRED");
  });

  it("normalizes numeric .code to string (e.g. StreamableHTTPError HTTP status)", () => {
    // StreamableHTTPError sets this.code = numeric HTTP status (404, 401, etc.)
    const cause = new Error("Streamable HTTP error: Error POSTing to endpoint: Not Found");
    (cause as Error & { code: number }).code = 404;
    const d = describeTransportError(transportError("failed", cause), "transport_connect");
    // causeCode must be string "404", not number 404
    expect(d.causeCode).toBe("404");
    expect(typeof d.causeCode).toBe("string");
    // safeMessage takes the code path — response body text never appears
    expect(d.safeMessage).toBe("404");
    expect(d.safeMessage).not.toContain("Not Found");
  });
});

// ---------------------------------------------------------------------------
// 3. IP family reporting
// ---------------------------------------------------------------------------

describe("describeTransportError — selectedIpFamily", () => {
  it("reports family 4 for a pinned IPv4 address", () => {
    const err = new TransportError("failed", undefined, 4);
    expect(describeTransportError(err, "transport_connect").selectedIpFamily).toBe(4);
  });

  it("reports family 6 for a pinned IPv6 address", () => {
    const err = new TransportError("failed", undefined, 6);
    expect(describeTransportError(err, "transport_connect").selectedIpFamily).toBe(6);
  });

  it("reports null when no IP was pinned", () => {
    const err = new TransportError("failed", undefined, null);
    expect(describeTransportError(err, "transport_connect").selectedIpFamily).toBeNull();
  });

  it("reports null when selectedIpFamily is not set", () => {
    const err = new TransportError("failed");
    expect(describeTransportError(err, "transport_connect").selectedIpFamily).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. safeMessage sanitization
// ---------------------------------------------------------------------------

describe("describeTransportError — safeMessage", () => {
  it("uses code+syscall and never includes the IPv6 address from the error message", () => {
    const cause = nodeError("connect ENETUNREACH 2a00:1450:4006:820::2013:443", "ENETUNREACH", "connect");
    const d = describeTransportError(transportError("failed", fetchFailed(cause)), "transport_connect");
    expect(d.safeMessage).toBe("ENETUNREACH syscall:connect");
    expect(d.safeMessage).not.toMatch(/2a00/);
  });

  it("uses code+syscall and never includes the IPv4 address from the error message", () => {
    const cause = nodeError("connect ECONNREFUSED 93.184.216.34:443", "ECONNREFUSED", "connect");
    const d = describeTransportError(transportError("failed", cause), "transport_connect");
    expect(d.safeMessage).toBe("ECONNREFUSED syscall:connect");
    expect(d.safeMessage).not.toMatch(/93\.184/);
  });

  // Fallback path: no code/syscall → safeMessage is the literal "unclassified"
  // (raw message text is never passed through — no sanitizer gaps possible).
  it("emits 'unclassified' for a cause with no code — never leaks IPv4", () => {
    const cause = new Error("raw message with 192.168.1.1 in it");
    const d = describeTransportError(transportError("failed", cause), "transport_connect");
    expect(d.safeMessage).toBe("unclassified");
    expect(d.safeMessage).not.toMatch(/192\.168/);
  });

  it("emits 'unclassified' for a cause with no code — never leaks IPv6", () => {
    const cause = new Error("failed at 2a00:1450:4006:820::2013 during TLS");
    const d = describeTransportError(transportError("failed", cause), "transport_connect");
    expect(d.safeMessage).toBe("unclassified");
    expect(d.safeMessage).not.toMatch(/2a00/);
  });

  it("emits 'unclassified' for a cause with no code — never leaks URLs or credentials", () => {
    const cause = new Error("Could not reach https://secret.example.com/path?token=abc");
    const d = describeTransportError(transportError("failed", cause), "transport_connect");
    expect(d.safeMessage).toBe("unclassified");
    expect(d.safeMessage).not.toContain("secret.example.com");
    expect(d.safeMessage).not.toContain("token=abc");
  });

  it("emits 'unclassified' for a cause with no code — never leaks bearer tokens", () => {
    const cause = new Error("Auth error: Bearer eyJhbGciOiJSUzI1NiJ9.payload");
    const d = describeTransportError(transportError("failed", cause), "transport_connect");
    expect(d.safeMessage).toBe("unclassified");
    expect(d.safeMessage).not.toContain("eyJhbGciOiJSUzI1NiJ9");
  });

  it("emits 'unclassified' for a cause with no code — never leaks token= patterns", () => {
    const cause = new Error("connection failed token=supersecret-value");
    const d = describeTransportError(transportError("failed", cause), "transport_connect");
    expect(d.safeMessage).toBe("unclassified");
    expect(d.safeMessage).not.toContain("supersecret-value");
  });

  it("emits 'unclassified' for a cause with no code — never leaks bare host:port", () => {
    const cause = new Error("getaddrinfo failed for api.internal.corp:8443");
    const d = describeTransportError(transportError("failed", cause), "transport_connect");
    expect(d.safeMessage).toBe("unclassified");
    expect(d.safeMessage).not.toContain("api.internal.corp");
  });

  it("emits 'unclassified' for a cause with no code — never leaks multiline/stack content", () => {
    const cause = new Error("boom\n    at Object.<anonymous> (/app/secret/path.js:10:5)");
    const d = describeTransportError(transportError("failed", cause), "transport_connect");
    expect(d.safeMessage).toBe("unclassified");
    expect(d.safeMessage).not.toContain("secret");
    expect(d.safeMessage).not.toContain("\n");
  });

  it("safeMessage is always short when unclassified", () => {
    const longMsg = "a".repeat(200);
    const cause = new Error(longMsg);
    const d = describeTransportError(transportError("failed", cause), "transport_connect");
    expect(d.safeMessage.length).toBeLessThanOrEqual(120);
  });
});

// ---------------------------------------------------------------------------
// 5. Output schema — no raw error objects, no stack traces
// ---------------------------------------------------------------------------

describe("describeTransportError — fixed schema", () => {
  it("returns all required fields", () => {
    const err = transportError("failed", nodeError("ECONNREFUSED", "ECONNREFUSED", "connect"), 4);
    const d: TransportDiagnostic = describeTransportError(err, "transport_connect");
    const keys: Array<keyof TransportDiagnostic> = [
      "phase", "errorName", "errorCode", "causeName",
      "causeCode", "causeSyscall", "selectedIpFamily", "safeMessage",
    ];
    for (const k of keys) expect(d).toHaveProperty(k);
  });

  it("all field values are primitives — no Error objects or arrays", () => {
    const err = transportError("failed", nodeError("ENETUNREACH", "ENETUNREACH", "connect"), 6);
    const d = describeTransportError(err, "transport_connect");
    for (const [, v] of Object.entries(d)) {
      expect(v === null || typeof v === "string" || typeof v === "number").toBe(true);
    }
  });

  it("safeMessage never contains a stack-trace marker", () => {
    const cause = nodeError("ECONNREFUSED", "ECONNREFUSED", "connect");
    const err = transportError("failed", cause);
    const d = describeTransportError(err, "transport_connect");
    expect(d.safeMessage).not.toContain("    at ");
    expect(d.safeMessage).not.toContain("\n");
  });

  it("phase is preserved verbatim", () => {
    const d = describeTransportError(transportError("failed"), "my_phase");
    expect(d.phase).toBe("my_phase");
  });

  it("errorName is the TransportError class name", () => {
    const d = describeTransportError(transportError("failed"), "transport_connect");
    expect(d.errorName).toBe("TransportError");
  });
});

// ---------------------------------------------------------------------------
// 6. Integration: onDiagnostic callback is called for TRANSPORT_ERROR
//    and NOT called for SSRF errors — client finding is unchanged
// ---------------------------------------------------------------------------

describe("runCheck — onDiagnostic callback integration", () => {
  it("emits a diagnostic and still returns TRANSPORT_ERROR finding on connection refused", async () => {
    const diagnostics: TransportDiagnostic[] = [];
    // Port 1 on localhost — always ECONNREFUSED, resolves quickly
    const report = await runCheck("http://localhost:1/mcp", {
      allowHttp: true,
      timeoutMs: 3000,
      onDiagnostic: (d) => diagnostics.push(d),
    });

    expect(report.overallStatus).toBe("FAIL");
    const finding = report.findings.find((f) => f.code === "TRANSPORT_ERROR");
    expect(finding).toBeDefined();

    // Callback must have fired exactly once
    expect(diagnostics).toHaveLength(1);
    const d = diagnostics[0]!;
    expect(d.phase).toBe("transport_connect");
    expect(d.errorName).toBe("TransportError");
    // safeMessage must not contain localhost or IP
    expect(d.safeMessage).not.toMatch(/localhost/i);
    expect(d.safeMessage).not.toMatch(/127\.\d+\.\d+\.\d+/);
  }, 8000);

  it("does NOT call onDiagnostic for SSRF-blocked requests", async () => {
    const diagnostics: TransportDiagnostic[] = [];
    // HTTP to a non-localhost host → HTTPS_REQUIRED SSRF rejection before transport
    const report = await runCheck("https://192.168.1.1/mcp", {
      timeoutMs: 3000,
      onDiagnostic: (d) => diagnostics.push(d),
    });

    expect(report.overallStatus).toBe("FAIL");
    const ssrfFinding = report.findings.find(
      (f) => f.code === "SSRF_BLOCKED" || f.code === "HTTPS_REQUIRED",
    );
    expect(ssrfFinding).toBeDefined();
    // Diagnostic must NOT fire for SSRF — those have their own classified handling
    expect(diagnostics).toHaveLength(0);
  }, 8000);

  it("client-facing report contains generic TRANSPORT_ERROR message, not internal details", async () => {
    const emitted: string[] = [];
    const report = await runCheck("http://localhost:1/mcp", {
      allowHttp: true,
      timeoutMs: 3000,
      onDiagnostic: (d) => emitted.push(JSON.stringify(d)),
    });

    const finding = report.findings.find((f) => f.code === "TRANSPORT_ERROR");
    expect(finding).toBeDefined();
    // The finding message must not contain raw diagnostic details
    const finding_msg = finding!.message;
    expect(finding_msg).not.toContain('"causeCode"');
    expect(finding_msg).not.toContain('"selectedIpFamily"');
    expect(finding_msg).not.toContain('"phase"');
  }, 8000);
});

// ---------------------------------------------------------------------------
// 7. Unchanged SSRF rejection behavior
// ---------------------------------------------------------------------------

describe("SSRF rejection — unchanged after diagnostics addition", () => {
  it("blocks private IPv4 addresses", async () => {
    const report = await runCheck("https://10.0.0.1/mcp", { timeoutMs: 2000 });
    expect(report.overallStatus).toBe("FAIL");
    expect(report.findings.some((f) => f.code === "SSRF_BLOCKED")).toBe(true);
  }, 5000);

  it("blocks link-local 169.254.x.x addresses", async () => {
    const report = await runCheck("https://169.254.169.254/mcp", { timeoutMs: 2000 });
    expect(report.overallStatus).toBe("FAIL");
    expect(report.findings.some((f) => f.code === "SSRF_BLOCKED")).toBe(true);
  }, 5000);

  it("rejects HTTP in production mode", async () => {
    const report = await runCheck("http://example.com/mcp", { timeoutMs: 2000 });
    expect(report.overallStatus).toBe("FAIL");
    expect(report.findings.some((f) => f.code === "HTTPS_REQUIRED")).toBe(true);
  }, 5000);

  it("SsrfError is still the correct class for direct SSRF checks", () => {
    const err = new SsrfError("Blocked", "BLOCKED_IP");
    expect(err).toBeInstanceOf(SsrfError);
    expect(err.reason).toBe("BLOCKED_IP");
  });
});
