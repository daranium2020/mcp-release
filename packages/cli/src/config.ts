/**
 * Config file loader for mcp-release.config.yml.
 *
 * Parses and validates the YAML config file. Environment variables in header
 * values (${VAR_NAME} syntax) are resolved at call-time, not at parse time,
 * so secrets never appear in parse-error messages.
 *
 * Resolved values are never printed or logged; callers must redact them before
 * any user-visible output.
 */

import { readFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import yaml from "js-yaml";
import type { ScenarioInput, ScenarioExpectation } from "@mcp-release/core";

export type ConfigTimeouts = {
  connectMs?: number;
  responseMs?: number;
};

export type ConfigRetries = {
  maxAttempts?: number;
  backoffMs?: number;
  /** Failure categories to retry. Valid: rate-limit, server-error, connection-failure, response-timeout. */
  retryOn?: string[];
};

export type ConfigScenarioExpect = {
  result?: "pass" | "warning" | "fail";
  httpStatus?: number;
};

export type ConfigScenario = {
  name: string;
  headers?: Record<string, string>;
  removeHeaders?: string[];
  expect: ConfigScenarioExpect;
};

export type ParsedConfig = {
  version: 1;
  endpoint: string;
  headers: Record<string, string>;
  timeouts: ConfigTimeouts;
  retries: ConfigRetries;
  scenarios: ConfigScenario[];
  /** Resolved absolute path of the config file. */
  filePath: string;
  /** Basename of the config file for display (no directory). */
  fileBasename: string;
};

type RawConfig = {
  version?: unknown;
  endpoint?: unknown;
  headers?: unknown;
  timeouts?: unknown;
  retries?: unknown;
  scenarios?: unknown;
};

function assertString(v: unknown, field: string): string {
  if (typeof v !== "string" || v.trim() === "") {
    throw new Error(`Config: "${field}" must be a non-empty string`);
  }
  return v.trim();
}

function assertRecordOfStrings(v: unknown, field: string): Record<string, string> {
  if (v === undefined || v === null) return {};
  if (typeof v !== "object" || Array.isArray(v)) {
    throw new Error(`Config: "${field}" must be a mapping of string keys to string values`);
  }
  const result: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val !== "string") {
      throw new Error(`Config: "${field}.${k}" must be a string`);
    }
    result[k] = val;
  }
  return result;
}

function assertStringArray(v: unknown, field: string): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new Error(`Config: "${field}" must be an array`);
  return v.map((item, i) => {
    if (typeof item !== "string") throw new Error(`Config: "${field}[${i}]" must be a string`);
    return item;
  });
}

function assertPositiveInt(v: unknown, field: string): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) {
    throw new Error(`Config: "${field}" must be a positive integer, got ${String(v)}`);
  }
  return v;
}

function parseScenario(raw: unknown, idx: number): ConfigScenario {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`Config: scenarios[${idx}] must be an object`);
  }
  const s = raw as Record<string, unknown>;
  const name = assertString(s["name"], `scenarios[${idx}].name`);
  const headers = assertRecordOfStrings(s["headers"], `scenarios[${idx}].headers`);
  const removeHeaders = assertStringArray(s["removeHeaders"], `scenarios[${idx}].removeHeaders`);

  if (s["expect"] === undefined || s["expect"] === null || typeof s["expect"] !== "object" || Array.isArray(s["expect"])) {
    throw new Error(`Config: scenarios[${idx}].expect must be an object`);
  }
  const exp = s["expect"] as Record<string, unknown>;

  const expect: ConfigScenarioExpect = {};
  if (exp["result"] !== undefined) {
    if (exp["result"] !== "pass" && exp["result"] !== "warning" && exp["result"] !== "fail") {
      throw new Error(`Config: scenarios[${idx}].expect.result must be "pass", "warning", or "fail"`);
    }
    expect.result = exp["result"] as "pass" | "warning" | "fail";
  }
  if (exp["httpStatus"] !== undefined) {
    const status = assertPositiveInt(exp["httpStatus"], `scenarios[${idx}].expect.httpStatus`);
    if (status !== undefined) expect.httpStatus = status;
  }

  return { name, headers, removeHeaders, expect };
}

export function loadConfig(configPath: string): ParsedConfig {
  const filePath = resolve(configPath);
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (err) {
    throw new Error(
      `Cannot read config file "${basename(filePath)}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let doc: unknown;
  try {
    doc = yaml.load(raw);
  } catch (err) {
    throw new Error(
      `Cannot parse config file "${basename(filePath)}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    throw new Error(`Config file "${basename(filePath)}" must be a YAML mapping`);
  }
  const cfg = doc as RawConfig;

  if (cfg.version !== 1) {
    throw new Error(`Config: "version" must be 1, got ${String(cfg.version)}`);
  }

  const endpoint = assertString(cfg.endpoint, "endpoint");
  const headers = assertRecordOfStrings(cfg.headers, "headers");

  const timeouts: ConfigTimeouts = {};
  if (cfg.timeouts !== undefined && cfg.timeouts !== null && typeof cfg.timeouts === "object") {
    const t = cfg.timeouts as Record<string, unknown>;
    const c = assertPositiveInt(t["connectMs"], "timeouts.connectMs");
    const r = assertPositiveInt(t["responseMs"], "timeouts.responseMs");
    if (c !== undefined) timeouts.connectMs = c;
    if (r !== undefined) timeouts.responseMs = r;
  }

  const VALID_RETRY_CATEGORIES = new Set([
    "rate-limit",
    "server-error",
    "connection-failure",
    "response-timeout",
  ]);

  const retries: ConfigRetries = {};
  if (cfg.retries !== undefined && cfg.retries !== null && typeof cfg.retries === "object") {
    const r = cfg.retries as Record<string, unknown>;
    const ma = assertPositiveInt(r["maxAttempts"], "retries.maxAttempts");
    const bm = assertPositiveInt(r["backoffMs"], "retries.backoffMs");
    if (ma !== undefined) retries.maxAttempts = ma;
    if (bm !== undefined) retries.backoffMs = bm;
    if (r["retryOn"] !== undefined) {
      const cats = assertStringArray(r["retryOn"], "retries.retryOn");
      for (const cat of cats) {
        if (!VALID_RETRY_CATEGORIES.has(cat)) {
          throw new Error(
            `Config: "retries.retryOn" contains unknown category "${cat}". ` +
            `Valid values: ${[...VALID_RETRY_CATEGORIES].join(", ")}`,
          );
        }
      }
      retries.retryOn = cats;
    }
  }

  const scenariosRaw = cfg.scenarios;
  const scenarios: ConfigScenario[] = [];
  if (scenariosRaw !== undefined && scenariosRaw !== null) {
    if (!Array.isArray(scenariosRaw)) {
      throw new Error(`Config: "scenarios" must be an array`);
    }
    for (let i = 0; i < scenariosRaw.length; i++) {
      scenarios.push(parseScenario(scenariosRaw[i], i));
    }
  }

  return {
    version: 1,
    endpoint,
    headers,
    timeouts,
    retries,
    scenarios,
    filePath,
    fileBasename: basename(filePath),
  };
}

/**
 * Resolve ${VAR_NAME} placeholders in all header values using the given env.
 * Throws if any referenced variable is not set.
 * The resolved headers must be treated as secret and never logged.
 */
export function resolveConfigHeaders(
  headers: Record<string, string>,
  env: Record<string, string | undefined>,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [name, template] of Object.entries(headers)) {
    resolved[name] = template.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/gi, (_match, varName: string) => {
      const value = env[varName];
      if (value === undefined) {
        throw new Error(
          `Header "${name}": environment variable "${varName}" is not set`,
        );
      }
      return value;
    });
  }
  return resolved;
}

/** Convert a ConfigScenario to the ScenarioInput type expected by the core runner. */
export function toScenarioInput(
  s: ConfigScenario,
  env: Record<string, string | undefined>,
): ScenarioInput {
  const extraHeaders = resolveConfigHeaders(s.headers ?? {}, env);
  const expected: ScenarioExpectation = {};
  if (s.expect.result !== undefined) expected.result = s.expect.result;
  if (s.expect.httpStatus !== undefined) expected.httpStatus = s.expect.httpStatus;

  return {
    name: s.name,
    extraHeaders,
    removeHeaders: s.removeHeaders ?? [],
    expected,
  };
}
