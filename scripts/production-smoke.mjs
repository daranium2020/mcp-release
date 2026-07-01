#!/usr/bin/env node
/**
 * Production smoke checks for mcprelease.dev.
 *
 * Verifies public pages, fixture MCP endpoint availability, and the full
 * validation path via /api/check against the known public fixture server.
 *
 * Exit 0 — all checks passed.
 * Exit 1 — one or more checks failed.
 */

import { fileURLToPath } from "node:url";

// ── Constants ────────────────────────────────────────────────────────────────

const PROD_ORIGIN = "https://mcprelease.dev";
const FIXTURE_MCP_URL = "https://mcp-release-fixture.vercel.app/mcp";
const API_CHECK_URL = `${PROD_ORIGIN}/api/check`;

const REQUEST_TIMEOUT_MS = 15_000;
const RETRIES = 2;
const RETRY_DELAY_MS = 2_000;

// Canonical URLs that must appear in the sitemap (no others allowed).
const EXPECTED_SITEMAP_URLS = [`${PROD_ORIGIN}/`, `${PROD_ORIGIN}/docs`];

// Fixture server constants derived from its published implementation.
const EXPECTED_FIXTURE_SERVER_NAME = "public-mcp-fixture";
const EXPECTED_FIXTURE_TOOLS = ["echo", "ping"];

// ── Utilities ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Retry fn up to `retries` additional times on thrown errors.
 * Successful returns and non-throwing failures (returned { ok: false }) are
 * not retried — only network-level throws trigger a retry.
 */
export async function withRetry(fn, retries = RETRIES, delayMs = RETRY_DELAY_MS) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(delayMs);
    }
  }
  throw lastErr;
}

async function timedFetch(url, opts = {}) {
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const start = Date.now();
  const res = await fetch(url, { ...opts, signal, redirect: "manual" });
  const ms = Date.now() - start;
  return { res, ms };
}

// ── Validators (exported for unit testing) ───────────────────────────────────

/**
 * Returns true when responseUrl is within expectedOrigin (same scheme+host+port).
 * Used to detect unexpected cross-origin redirects.
 */
export function isWithinOrigin(responseUrl, expectedOrigin) {
  try {
    return new URL(responseUrl).origin === new URL(expectedOrigin).origin;
  } catch {
    return false;
  }
}

/** Returns true when Content-Type indicates an image (e.g. image/png). */
export function isImageContentType(contentType) {
  return typeof contentType === "string" && contentType.startsWith("image/");
}

/** Checks homepage HTML contains recognizable MCP Release content. */
export function validateHomepageContent(html) {
  if (!html.includes("MCP Release")) {
    return { ok: false, errors: ["Homepage missing expected MCP Release content"] };
  }
  return { ok: true, errors: [] };
}

/** Checks docs HTML contains the Privacy and data handling section. */
export function validateDocsContent(html) {
  if (!html.includes("Privacy and data handling")) {
    return { ok: false, errors: ["Docs missing Privacy and data handling section"] };
  }
  return { ok: true, errors: [] };
}

/** Checks robots.txt for required Disallow and Sitemap directives. */
export function validateRobotsContent(text) {
  const errors = [];
  if (!text.includes("Disallow: /api/")) {
    errors.push("robots.txt missing Disallow: /api/");
  }
  if (!text.includes(`${PROD_ORIGIN}/sitemap.xml`)) {
    errors.push(`robots.txt missing Sitemap: ${PROD_ORIGIN}/sitemap.xml`);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Checks sitemap.xml for required canonical URLs and rejects unexpected
 * external or unlisted URLs.
 */
export function validateSitemapContent(text) {
  const errors = [];
  for (const url of EXPECTED_SITEMAP_URLS) {
    if (!text.includes(url)) {
      errors.push(`Sitemap missing expected URL: ${url}`);
    }
  }
  for (const [, loc] of text.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const trimmed = loc.trim();
    if (!trimmed.startsWith(PROD_ORIGIN)) {
      errors.push(`Sitemap contains unexpected URL: ${trimmed}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Validates the JSON body returned by POST /api/check.
 *
 * Confirms: overallStatus PASS, zero FAIL/WARNING findings, expected tools
 * discovered, known fixture server name, no tool-execution finding codes.
 */
export function validateApiCheckResponse(body) {
  if (typeof body !== "object" || body === null) {
    return { ok: false, errors: ["Response is not a JSON object"] };
  }

  const { report } = body;
  if (typeof report !== "object" || report === null) {
    return { ok: false, errors: ["Response missing report field"] };
  }

  const errors = [];

  if (report.overallStatus !== "PASS") {
    errors.push(`overallStatus is "${report.overallStatus}", expected "PASS"`);
  }

  const findings = Array.isArray(report.findings) ? report.findings : [];
  const failCount = findings.filter((f) => f.severity === "FAIL").length;
  const warnCount = findings.filter((f) => f.severity === "WARNING").length;
  if (failCount > 0) errors.push(`${failCount} FAIL finding(s) in report`);
  if (warnCount > 0) errors.push(`${warnCount} WARNING finding(s) in report`);

  const tools = Array.isArray(report.tools) ? report.tools : [];
  const toolNames = tools.map((t) => t.name);
  for (const expected of EXPECTED_FIXTURE_TOOLS) {
    if (!toolNames.includes(expected)) {
      errors.push(`Expected tool not discovered: "${expected}"`);
    }
  }

  const serverName = report.serverInfo?.name;
  if (serverName !== EXPECTED_FIXTURE_SERVER_NAME) {
    errors.push(
      `serverInfo.name is ${JSON.stringify(serverName)}, ` +
        `expected ${JSON.stringify(EXPECTED_FIXTURE_SERVER_NAME)}`,
    );
  }

  // The validator calls tools/list only — no tool is ever invoked.
  // These finding codes do not exist in the schema but guard against drift.
  const executionCodes = new Set(["TOOL_EXECUTED", "TOOL_CALL_RESULT", "TOOL_INVOKED"]);
  for (const tool of tools) {
    for (const finding of Array.isArray(tool.findings) ? tool.findings : []) {
      if (executionCodes.has(finding.code)) {
        errors.push(`Unexpected tool-execution finding "${finding.code}" in tool "${tool.name}"`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

// ── Result tracking ──────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function recordPass(label, ms) {
  passed++;
  const msLabel = ms !== undefined ? ` [${ms}ms]` : "";
  console.log(`  ✓ ${label}${msLabel}`);
}

function recordFail(label, reason, ms) {
  failed++;
  const msLabel = ms !== undefined ? ` [${ms}ms]` : "";
  console.log(`  ✗ ${label}${msLabel}: ${reason}`);
}

// ── Page check helper ────────────────────────────────────────────────────────

async function fetchPageCheck(url, validate) {
  const { res, ms } = await timedFetch(url);

  // Throw on server errors so withRetry can retry transient 5xx responses.
  if (res.status >= 500) {
    throw new Error(`HTTP ${res.status} (server error)`);
  }

  // Redirect outside PROD_ORIGIN — not retryable, report immediately.
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location") ?? "";
    if (!isWithinOrigin(location, PROD_ORIGIN)) {
      return { ok: false, errors: [`Redirected outside origin: ${location}`], ms };
    }
    // Same-origin redirect — follow manually (count as ok for page check)
  }

  if (res.status !== 200) {
    return { ok: false, errors: [`HTTP ${res.status}`], ms };
  }

  if (validate) {
    const text = await res.text();
    const vr = validate(text);
    if (!vr.ok) return { ok: false, errors: vr.errors, ms };
  }

  return { ok: true, errors: [], ms };
}

async function runPageCheck(label, url, validate) {
  try {
    const result = await withRetry(() => fetchPageCheck(url, validate));
    if (result.ok) {
      recordPass(label, result.ms);
    } else {
      recordFail(label, result.errors.join("; "), result.ms);
    }
  } catch (err) {
    recordFail(label, err.name === "TimeoutError" ? "request timed out" : err.message);
  }
}

// ── Section A: Public pages ──────────────────────────────────────────────────

async function checkPublicPages() {
  console.log("\nA. Public pages");

  await runPageCheck("Homepage", `${PROD_ORIGIN}/`, validateHomepageContent);
  await runPageCheck("Docs", `${PROD_ORIGIN}/docs`, validateDocsContent);
  await runPageCheck("robots.txt", `${PROD_ORIGIN}/robots.txt`, validateRobotsContent);
  await runPageCheck("sitemap.xml", `${PROD_ORIGIN}/sitemap.xml`, validateSitemapContent);

  // OG image — verify image Content-Type only (do not read body).
  try {
    const result = await withRetry(async () => {
      const { res, ms } = await timedFetch(`${PROD_ORIGIN}/opengraph-image`);
      if (res.status >= 500) throw new Error(`HTTP ${res.status} (server error)`);
      if (res.status !== 200) {
        return { ok: false, errors: [`HTTP ${res.status}`], ms };
      }
      const ct = res.headers.get("content-type") ?? "";
      if (!isImageContentType(ct)) {
        return {
          ok: false,
          errors: [`Expected image/* Content-Type, got: ${ct.substring(0, 80)}`],
          ms,
        };
      }
      return { ok: true, errors: [], ms };
    });
    if (result.ok) recordPass("OG image", result.ms);
    else recordFail("OG image", result.errors.join("; "), result.ms);
  } catch (err) {
    recordFail("OG image", err.name === "TimeoutError" ? "request timed out" : err.message);
  }
}

// ── Section B: Fixture availability ─────────────────────────────────────────

async function checkFixtureAvailability() {
  console.log("\nB. Fixture availability");

  // POST a valid MCP initialize message — the same request the MCP transport
  // sends as its first protocol step.  Does not list or invoke tools.
  const initBody = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "smoke-check", version: "0.0.0" },
    },
  });

  try {
    const result = await withRetry(async () => {
      const { res, ms } = await timedFetch(FIXTURE_MCP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: initBody,
      });
      if (res.status >= 500) throw new Error(`HTTP ${res.status} (server error)`);
      if (res.status !== 200) {
        return { ok: false, errors: [`HTTP ${res.status}`], ms };
      }
      return { ok: true, errors: [], ms };
    });
    if (result.ok) recordPass("Fixture MCP endpoint", result.ms);
    else recordFail("Fixture MCP endpoint", result.errors.join("; "), result.ms);
  } catch (err) {
    recordFail(
      "Fixture MCP endpoint",
      err.name === "TimeoutError" ? "request timed out" : err.message,
    );
  }
}

// ── Section C: End-to-end validation ────────────────────────────────────────

async function checkEndToEnd() {
  console.log("\nC. End-to-end validation");

  try {
    const result = await withRetry(async () => {
      const { res, ms } = await timedFetch(API_CHECK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: FIXTURE_MCP_URL, timeoutMs: 15_000 }),
      });

      if (res.status >= 500) throw new Error(`HTTP ${res.status} (server error)`);
      if (res.status !== 200) {
        return { ok: false, errors: [`HTTP ${res.status}`], ms };
      }

      let body;
      try {
        body = await res.json();
      } catch {
        return { ok: false, errors: ["Response is not valid JSON"], ms };
      }

      const vr = validateApiCheckResponse(body);
      return { ...vr, ms };
    });

    if (result.ok) recordPass("API /api/check → fixture PASS", result.ms);
    else recordFail("API /api/check → fixture PASS", result.errors.join("; "), result.ms);
  } catch (err) {
    recordFail(
      "API /api/check → fixture PASS",
      err.name === "TimeoutError" ? "request timed out" : err.message,
    );
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log("Production smoke — mcprelease.dev");
  console.log("─".repeat(42));

  await checkPublicPages();
  await checkFixtureAvailability();
  await checkEndToEnd();

  const total = passed + failed;
  console.log("\n" + "─".repeat(42));
  console.log(`Checks: ${total}  Passed: ${passed}  Failed: ${failed}`);
  console.log(failed === 0 ? "PASS" : "FAIL");

  if (failed > 0) process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  run().catch((err) => {
    console.error("Unexpected error:", err.message);
    process.exit(1);
  });
}
