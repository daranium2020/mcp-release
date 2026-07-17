"use client";

import { useCallback } from "react";
import type { CheckReport, Finding, FindingSeverity } from "@mcp-release/core";
import { toJson } from "@mcp-release/reporter";
import { toMarkdown } from "@mcp-release/reporter";
import { aggregateFindings } from "../lib/aggregate-findings";
import styles from "./Results.module.css";

type Props = {
  report: CheckReport;
  onReset: () => void;
};

function severityClass(s: FindingSeverity): string {
  if (s === "FAIL") return styles.fail;
  if (s === "WARNING") return styles.warn;
  return styles.pass;
}

function SeverityBadge({ severity }: { severity: FindingSeverity }) {
  return (
    <span className={`${styles.badge} ${severityClass(severity)}`}>
      {severity}
    </span>
  );
}

function findingsByGroup(findings: Finding[]): {
  fail: Finding[];
  warn: Finding[];
  pass: Finding[];
} {
  return {
    fail: findings.filter((f) => f.severity === "FAIL"),
    warn: findings.filter((f) => f.severity === "WARNING"),
    pass: findings.filter((f) => f.severity === "PASS"),
  };
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function formatTs(iso: string): string {
  try {
    return new Date(iso).toUTCString();
  } catch {
    return iso;
  }
}

function FindingsGroup({
  label,
  findings,
  defaultOpen = false,
}: {
  label: string;
  findings: Finding[];
  defaultOpen?: boolean;
}) {
  if (findings.length === 0) return null;
  return (
    <details className={styles.findingGroup} open={defaultOpen}>
      <summary className={styles.findingGroupLabel}>
        {label}
        <span className={styles.findingCount}>{findings.length}</span>
      </summary>
      <ul className={styles.findingList}>
        {findings.map((f, i) => (
          <li key={i} className={styles.findingItem}>
            <SeverityBadge severity={f.severity} />
            <code className={styles.findingCode}>{f.code}</code>
            <span className={styles.findingMsg}>{f.message}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export default function Results({ report, onReset }: Props) {
  const hostname = safeHostname(report.serverUrl);
  const groups = findingsByGroup(report.findings);

  // Aggregate findings across top-level and all tool-level findings.
  // Top-level findings cover transport/protocol; tool findings cover schema
  // validation. Neither set contains the other, so concatenation is safe.
  const { counts } = aggregateFindings(report);
  const { fail: failCount, warn: warnCount, pass: passCount } = counts;

  const handleCopyJson = useCallback(async () => {
    const json = toJson(report);
    try {
      await navigator.clipboard.writeText(json);
    } catch {
      // Fallback: select a textarea
    }
  }, [report]);

  const handleDownloadJson = useCallback(() => {
    const json = toJson(report);
    download(json, "mcp-release-report.json", "application/json");
  }, [report]);

  const handleDownloadMarkdown = useCallback(() => {
    const md = toMarkdown(report);
    download(md, "mcp-release-report.md", "text/markdown");
  }, [report]);

  return (
    <section className={styles.root} aria-label="Validation results">
      {/* Status card */}
      <div
        className={`${styles.statusCard} ${severityClass(report.overallStatus)}`}
      >
        <div className={styles.statusLeft}>
          <span className={styles.statusLabel}>Overall Status</span>
          <span
            className={`${styles.statusValue} ${severityClass(report.overallStatus)}`}
          >
            {report.overallStatus}
          </span>
        </div>
        <div className={styles.statusMeta}>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Endpoint</span>
            <code className={styles.metaValue}>{hostname}</code>
          </div>
          {report.protocolVersion && (
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Protocol</span>
              <code className={styles.metaValue}>{report.protocolVersion}</code>
            </div>
          )}
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Duration</span>
            <code className={styles.metaValue}>{report.durationMs}ms</code>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Started at</span>
            <span className={styles.metaValue}>{formatTs(report.startedAt ?? report.checkedAt)}</span>
          </div>
        </div>
      </div>

      {/* Summary metrics */}
      <div className={styles.metricsGrid}>
        <div className={styles.metric}>
          <span className={styles.metricNum + " " + styles.fail}>{failCount}</span>
          <span className={styles.metricLabel}>Failures</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricNum + " " + styles.warn}>{warnCount}</span>
          <span className={styles.metricLabel}>Warnings</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricNum + " " + styles.pass}>{passCount}</span>
          <span className={styles.metricLabel}>Passed</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricNum}>{report.tools.length}</span>
          <span className={styles.metricLabel}>Tools</span>
        </div>
        {report.transport && (
          <div className={styles.metric}>
            <span className={styles.metricNum}>
              {report.transport.redirectCount}
            </span>
            <span className={styles.metricLabel}>Redirects</span>
          </div>
        )}
        {report.serverInfo?.name && (
          <div className={styles.metric}>
            <code className={styles.metricCode}>{report.serverInfo.name}</code>
            <span className={styles.metricLabel}>Server name</span>
          </div>
        )}
      </div>

      {/* Findings */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Findings</h2>
        {report.findings.length === 0 ? (
          <p className={styles.empty}>No findings.</p>
        ) : (
          <div className={styles.findingGroups}>
            <FindingsGroup label="Failures" findings={groups.fail} defaultOpen />
            <FindingsGroup label="Warnings" findings={groups.warn} defaultOpen />
            <FindingsGroup label="Passed checks" findings={groups.pass} />
          </div>
        )}
      </div>

      {/* Tools */}
      {report.tools.length > 0 && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>
            Discovered Tools ({report.tools.length})
          </h2>
          <ul className={styles.toolList}>
            {report.tools.map((tool) => {
              const tGroups = findingsByGroup(tool.findings);
              return (
                <li key={tool.name} className={styles.toolItem}>
                  <div className={styles.toolHeader}>
                    <code className={styles.toolName}>{tool.name}</code>
                    <SeverityBadge severity={tool.overallStatus} />
                  </div>
                  {tool.findings.length > 0 && (
                    <div className={styles.toolFindings}>
                      <FindingsGroup label="Failures" findings={tGroups.fail} defaultOpen />
                      <FindingsGroup label="Warnings" findings={tGroups.warn} defaultOpen />
                      <FindingsGroup label="Passed" findings={tGroups.pass} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Export + retry actions */}
      <div className={styles.actions}>
        <div className={styles.exportActions}>
          <button
            type="button"
            className={styles.exportBtn}
            onClick={handleCopyJson}
          >
            Copy JSON
          </button>
          <button
            type="button"
            className={styles.exportBtn}
            onClick={handleDownloadJson}
          >
            Download JSON
          </button>
          <button
            type="button"
            className={styles.exportBtn}
            onClick={handleDownloadMarkdown}
          >
            Download Markdown
          </button>
        </div>
        <button
          type="button"
          className={styles.resetBtn}
          onClick={onReset}
        >
          Run another check
        </button>
      </div>
    </section>
  );
}

function download(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
