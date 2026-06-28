"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { CheckReport } from "@mcp-release/core";
import type { CheckApiResponse } from "../types/api";
import Results from "./Results";
import styles from "./CheckClient.module.css";

type Phase =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; report: CheckReport }
  | { kind: "error"; message: string; code: string };

// ---- Dev fixtures (tree-shaken in production builds) ----
// process.env.NODE_ENV is replaced with a string literal at build time;
// in production builds Next.js eliminates the false branch entirely.
const DEV_MODE = process.env.NODE_ENV !== "production";

const DEV_PASS_REPORT: CheckReport = {
  schemaVersion: "1",
  serverUrl: "https://demo.example.com/mcp",
  checkedAt: "2026-06-27T00:00:00.000Z",
  durationMs: 234,
  overallStatus: "PASS",
  transport: {
    httpStatus: 200,
    httpStatusText: "OK",
    durationMs: 120,
    redirectCount: 0,
    headersAvailable: true,
  },
  protocolVersion: "2024-11-05",
  serverInfo: { name: "demo-server", version: "2.1.0" },
  findings: [
    {
      code: "INIT_OK",
      severity: "PASS",
      message: "MCP initialization succeeded",
    },
    { code: "TOOLS_LIST_OK", severity: "PASS", message: "Found 2 tool(s)" },
  ],
  tools: [
    {
      name: "get_weather",
      overallStatus: "PASS",
      findings: [
        {
          code: "TOOL_OK",
          severity: "PASS",
          message: 'Tool "get_weather" passed all checks',
        },
      ],
    },
    {
      name: "search_web",
      overallStatus: "PASS",
      findings: [
        {
          code: "TOOL_OK",
          severity: "PASS",
          message: 'Tool "search_web" passed all checks',
        },
      ],
    },
  ],
};

const DEV_FAIL_REPORT: CheckReport = {
  schemaVersion: "1",
  serverUrl: "https://broken.example.com/mcp",
  checkedAt: "2026-06-27T00:00:00.000Z",
  durationMs: 456,
  overallStatus: "FAIL",
  transport: {
    httpStatus: 200,
    httpStatusText: "OK",
    durationMs: 180,
    redirectCount: 0,
    headersAvailable: true,
  },
  protocolVersion: "2024-11-05",
  serverInfo: { name: "broken-server", version: "1.0.0" },
  findings: [
    {
      code: "INIT_OK",
      severity: "PASS",
      message: "MCP initialization succeeded",
    },
    { code: "TOOLS_LIST_OK", severity: "PASS", message: "Found 1 tool(s)" },
  ],
  tools: [
    {
      name: "invalid tool name!",
      overallStatus: "FAIL",
      findings: [
        {
          code: "TOOL_INVALID_NAME",
          severity: "FAIL",
          message:
            'Tool name "invalid tool name!" contains invalid characters (expected lowercase letters, digits, and underscores only)',
        },
      ],
    },
  ],
};

const DEV_WARN_REPORT: CheckReport = {
  schemaVersion: "1",
  serverUrl: "https://legacy.example.com/mcp",
  checkedAt: "2026-06-27T00:00:00.000Z",
  durationMs: 312,
  overallStatus: "WARNING",
  transport: {
    httpStatus: 200,
    httpStatusText: "OK",
    durationMs: 140,
    redirectCount: 1,
    headersAvailable: true,
  },
  protocolVersion: "2024-11-05",
  serverInfo: { name: "legacy-server", version: "0.9.0" },
  findings: [
    {
      code: "INIT_OK",
      severity: "PASS",
      message: "MCP initialization succeeded",
    },
    { code: "TOOLS_LIST_OK", severity: "PASS", message: "Found 1 tool(s)" },
  ],
  tools: [
    {
      name: "process_data",
      overallStatus: "WARNING",
      findings: [
        {
          code: "TOOL_EMPTY_DESCRIPTION",
          severity: "WARNING",
          message: 'Tool "process_data" has an empty description',
        },
        {
          code: "TOOL_OK",
          severity: "PASS",
          message: 'Tool "process_data" name and input schema are valid',
        },
      ],
    },
  ],
};

type CheckClientProps = {
  demoEndpoint?: string;
};

export default function CheckClient({ demoEndpoint }: CheckClientProps = {}) {
  const [endpoint, setEndpoint] = useState("");
  const [validationMsg, setValidationMsg] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const validate = useCallback((value: string): string => {
    if (!value.trim()) return "Endpoint is required";
    try {
      const url = new URL(value.trim());
      if (url.protocol !== "https:") return "Endpoint must use HTTPS";
      if (url.username || url.password) return "Endpoint must not contain credentials";
    } catch {
      return "Enter a valid URL (e.g. https://example.com/mcp)";
    }
    return "";
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const msg = validate(endpoint);
      if (msg) {
        setValidationMsg(msg);
        inputRef.current?.focus();
        return;
      }
      setValidationMsg("");
      setPhase({ kind: "loading" });

      try {
        const res = await fetch("/api/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: endpoint.trim() }),
        });

        const data = (await res.json()) as CheckApiResponse;

        if ("error" in data) {
          setPhase({ kind: "error", message: data.message, code: data.error });
        } else {
          setPhase({ kind: "done", report: data.report });
        }
      } catch {
        setPhase({
          kind: "error",
          message: "Could not reach the validation service. Please try again.",
          code: "NETWORK_ERROR",
        });
      }
    },
    [endpoint, validate],
  );

  const handleReset = useCallback(() => {
    setPhase({ kind: "idle" });
    setEndpoint("");
    setValidationMsg("");
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  // Scroll results into view after each transition into the "done" state.
  // useEffect runs after the DOM is painted, so resultsRef.current is set.
  // scroll-margin-top on the wrapper compensates for the sticky header.
  useEffect(() => {
    if (phase.kind !== "done") return;
    const el = resultsRef.current;
    if (!el) return;
    const prefersReduced =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    el.scrollIntoView({ behavior: prefersReduced ? "instant" : "smooth", block: "start" });
  }, [phase.kind]);

  const isLoading = phase.kind === "loading";

  return (
    <div className={styles.root}>
      <form
        className={styles.form}
        onSubmit={handleSubmit}
        aria-label="Endpoint validation form"
        noValidate
      >
        <div className={styles.inputRow}>
          <label htmlFor="endpoint-input" className={styles.label}>
            MCP Endpoint
          </label>
          <div className={styles.inputGroup}>
            <input
              ref={inputRef}
              id="endpoint-input"
              type="url"
              className={styles.input}
              value={endpoint}
              onChange={(e) => {
                setEndpoint(e.target.value);
                if (validationMsg) setValidationMsg(validate(e.target.value));
              }}
              placeholder="https://your-server.example.com/mcp"
              aria-describedby={validationMsg ? "endpoint-error" : undefined}
              aria-invalid={validationMsg ? "true" : undefined}
              disabled={isLoading}
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="submit"
              className={styles.submitBtn}
              disabled={isLoading}
              aria-busy={isLoading}
            >
              {isLoading ? (
                <>
                  <span className={styles.spinner} aria-hidden="true" />
                  Checking…
                </>
              ) : (
                "Run Release Check"
              )}
            </button>
          </div>
          {validationMsg && (
            <p
              id="endpoint-error"
              className={styles.fieldError}
              role="alert"
            >
              {validationMsg}
            </p>
          )}
        </div>
        <ul className={styles.trustList} aria-label="Validation guarantees">
          <li className={styles.trustItem}>MCP tools are never executed</li>
          <li className={styles.trustItem}>No credentials are stored</li>
          <li className={styles.trustItem}>Reports are deterministic and exportable</li>
        </ul>
        {demoEndpoint && phase.kind === "idle" && (
          <p className={styles.demoHint}>
            <button
              type="button"
              className={styles.demoBtn}
              onClick={() => {
                setEndpoint(demoEndpoint);
                setValidationMsg("");
                setTimeout(() => inputRef.current?.focus(), 0);
              }}
            >
              Try demo endpoint
            </button>
          </p>
        )}
      </form>

      {/* Development-only fixture panel — not rendered in production builds */}
      {DEV_MODE && (
        <div className={styles.devPanel}>
          <span className={styles.devLabel}>Dev fixtures</span>
          <div className={styles.devBtns}>
            <button
              type="button"
              className={styles.devBtn}
              onClick={() => {
                setValidationMsg("");
                setPhase({ kind: "done", report: DEV_PASS_REPORT });
              }}
            >
              PASS
            </button>
            <button
              type="button"
              className={styles.devBtn}
              onClick={() => {
                setValidationMsg("");
                setPhase({ kind: "done", report: DEV_FAIL_REPORT });
              }}
            >
              FAIL
            </button>
            <button
              type="button"
              className={styles.devBtn}
              onClick={() => {
                setValidationMsg("");
                setPhase({ kind: "done", report: DEV_WARN_REPORT });
              }}
            >
              WARNING
            </button>
            <button
              type="button"
              className={styles.devBtn}
              onClick={() => {
                setValidationMsg("");
                setPhase({
                  kind: "error",
                  code: "RATE_LIMIT_EXCEEDED",
                  message: "Too many requests. Please wait before checking again.",
                });
              }}
            >
              API Error
            </button>
            <button
              type="button"
              className={styles.devBtn}
              onClick={() => {
                setValidationMsg("");
                setPhase({ kind: "loading" });
              }}
            >
              Loading
            </button>
          </div>
        </div>
      )}

      {phase.kind === "error" && (
        <div className={styles.apiError} role="alert" aria-live="polite">
          <div className={styles.apiErrorHeader}>
            <span className={styles.apiErrorCode}>{phase.code}</span>
            <span className={styles.apiErrorTitle}>Check failed</span>
          </div>
          <p className={styles.apiErrorMessage}>{phase.message}</p>
          <button
            type="button"
            className={styles.retryBtn}
            onClick={handleReset}
          >
            Try again
          </button>
        </div>
      )}

      {phase.kind === "done" && (
        <div ref={resultsRef} className={styles.resultsWrapper} aria-live="polite">
          <Results report={phase.report} onReset={handleReset} />
        </div>
      )}
    </div>
  );
}
