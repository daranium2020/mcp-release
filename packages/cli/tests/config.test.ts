/**
 * Unit tests for the CLI config file loader (v0.3.0).
 *
 * Covers:
 *   - Valid YAML parsing
 *   - Missing required fields
 *   - Invalid field types
 *   - Env var resolution (${VAR})
 *   - Missing env var throws
 *   - toScenarioInput mapping
 */
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, resolveConfigHeaders, toScenarioInput } from "../src/config.js";

function writeTmpYaml(content: string): string {
  const dir = join(tmpdir(), `mcp-release-config-test-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${Date.now()}.yml`);
  writeFileSync(file, content, "utf8");
  return file;
}

const MINIMAL_VALID = `
version: 1
endpoint: https://example.com/mcp
scenarios:
  - name: default
    expect:
      result: pass
`;

const FULL_VALID = `
version: 1
endpoint: https://api.example.com/mcp
headers:
  Authorization: Bearer \${API_TOKEN}
  x-env: static-value
timeouts:
  connectMs: 5000
  responseMs: 10000
retries:
  maxAttempts: 3
  backoffMs: 500
  retryOn:
    - server-error
    - rate-limit
scenarios:
  - name: healthy
    expect:
      result: pass
  - name: missing-auth
    removeHeaders:
      - Authorization
    expect:
      httpStatus: 401
  - name: custom-token
    headers:
      Authorization: Bearer custom-token
    expect:
      result: pass
`;

// ---------------------------------------------------------------------------
// 1. Valid YAML parses correctly
// ---------------------------------------------------------------------------

describe("loadConfig — valid config", () => {
  it("parses minimal config", () => {
    const file = writeTmpYaml(MINIMAL_VALID);
    const cfg = loadConfig(file);
    expect(cfg.version).toBe(1);
    expect(cfg.endpoint).toBe("https://example.com/mcp");
    expect(cfg.scenarios).toHaveLength(1);
    expect(cfg.scenarios[0].name).toBe("default");
    expect(cfg.scenarios[0].expect.result).toBe("pass");
  });

  it("parses full config with headers, timeouts, retries, and scenarios", () => {
    const file = writeTmpYaml(FULL_VALID);
    const cfg = loadConfig(file);
    expect(cfg.endpoint).toBe("https://api.example.com/mcp");
    expect(cfg.headers["Authorization"]).toBe("Bearer ${API_TOKEN}");
    expect(cfg.headers["x-env"]).toBe("static-value");
    expect(cfg.timeouts.connectMs).toBe(5000);
    expect(cfg.timeouts.responseMs).toBe(10000);
    expect(cfg.retries.maxAttempts).toBe(3);
    expect(cfg.retries.backoffMs).toBe(500);
    expect(cfg.retries.retryOn).toContain("server-error");
    expect(cfg.retries.retryOn).toContain("rate-limit");
    expect(cfg.scenarios).toHaveLength(3);
  });

  it("scenario with removeHeaders", () => {
    const file = writeTmpYaml(FULL_VALID);
    const cfg = loadConfig(file);
    const s = cfg.scenarios[1];
    expect(s.name).toBe("missing-auth");
    expect(s.removeHeaders).toContain("Authorization");
    expect(s.expect.httpStatus).toBe(401);
  });

  it("scenario with extra headers override", () => {
    const file = writeTmpYaml(FULL_VALID);
    const cfg = loadConfig(file);
    const s = cfg.scenarios[2];
    expect(s.headers?.["Authorization"]).toBe("Bearer custom-token");
  });

  it("filePath is the absolute resolved path", () => {
    const file = writeTmpYaml(MINIMAL_VALID);
    const cfg = loadConfig(file);
    expect(cfg.filePath).toBe(file);
  });

  it("fileBasename is just the filename", () => {
    const file = writeTmpYaml(MINIMAL_VALID);
    const cfg = loadConfig(file);
    expect(cfg.fileBasename).not.toContain("/");
    expect(cfg.fileBasename).toMatch(/\.yml$/);
  });
});

// ---------------------------------------------------------------------------
// 2. Missing required fields
// ---------------------------------------------------------------------------

describe("loadConfig — missing required fields", () => {
  it("throws when version is missing", () => {
    const file = writeTmpYaml(`endpoint: https://x.com/mcp\nscenarios: []`);
    expect(() => loadConfig(file)).toThrow(/version/);
  });

  it("throws when version is not 1", () => {
    const file = writeTmpYaml(`version: 2\nendpoint: https://x.com/mcp\nscenarios: []`);
    expect(() => loadConfig(file)).toThrow(/version/);
  });

  it("throws when endpoint is missing", () => {
    const file = writeTmpYaml(`version: 1\nscenarios: []`);
    expect(() => loadConfig(file)).toThrow(/endpoint/);
  });

  it("throws when scenario name is missing", () => {
    const file = writeTmpYaml(`version: 1\nendpoint: https://x.com/mcp\nscenarios:\n  - expect:\n      result: pass`);
    expect(() => loadConfig(file)).toThrow(/name/);
  });

  it("throws when scenario expect is missing", () => {
    const file = writeTmpYaml(`version: 1\nendpoint: https://x.com/mcp\nscenarios:\n  - name: s1`);
    expect(() => loadConfig(file)).toThrow(/expect/);
  });

  it("throws when scenario expect.result has invalid value", () => {
    const file = writeTmpYaml(
      `version: 1\nendpoint: https://x.com/mcp\nscenarios:\n  - name: s\n    expect:\n      result: ok`,
    );
    expect(() => loadConfig(file)).toThrow(/result/);
  });

  it("throws when timeouts.connectMs is not a positive integer", () => {
    const file = writeTmpYaml(
      `version: 1\nendpoint: https://x.com/mcp\ntimeouts:\n  connectMs: -1\nscenarios: []`,
    );
    expect(() => loadConfig(file)).toThrow(/connectMs/);
  });

  it("throws when retries.retryOn contains an unknown category", () => {
    const file = writeTmpYaml(
      `version: 1\nendpoint: https://x.com/mcp\nretries:\n  maxAttempts: 3\n  retryOn:\n    - server-error\n    - bogus-category\nscenarios: []`,
    );
    expect(() => loadConfig(file)).toThrow(/bogus-category/);
  });

  it("accepts all four valid retryOn categories", () => {
    const file = writeTmpYaml(
      `version: 1\nendpoint: https://x.com/mcp\nretries:\n  maxAttempts: 3\n  retryOn:\n    - rate-limit\n    - server-error\n    - connection-failure\n    - response-timeout\nscenarios: []`,
    );
    const cfg = loadConfig(file);
    expect(cfg.retries.retryOn).toEqual(["rate-limit", "server-error", "connection-failure", "response-timeout"]);
  });

  it("parses config without retries block — retries is empty object", () => {
    const file = writeTmpYaml(MINIMAL_VALID);
    const cfg = loadConfig(file);
    expect(cfg.retries.maxAttempts).toBeUndefined();
    expect(cfg.retries.retryOn).toBeUndefined();
  });

  it("throws when file does not exist", () => {
    expect(() => loadConfig("/tmp/nonexistent-mcp-release-config-9999.yml")).toThrow();
  });

  it("throws when YAML is syntactically invalid", () => {
    const file = writeTmpYaml("{ bad yaml: [");
    expect(() => loadConfig(file)).toThrow(/parse/i);
  });
});

// ---------------------------------------------------------------------------
// 3. resolveConfigHeaders — env var substitution
// ---------------------------------------------------------------------------

describe("resolveConfigHeaders", () => {
  it("resolves ${VAR} from env", () => {
    const headers = { Authorization: "Bearer ${MY_TOKEN}" };
    const env = { MY_TOKEN: "secret123" };
    const result = resolveConfigHeaders(headers, env);
    expect(result["Authorization"]).toBe("Bearer secret123");
  });

  it("leaves static values unchanged", () => {
    const headers = { "content-type": "application/json" };
    const result = resolveConfigHeaders(headers, {});
    expect(result["content-type"]).toBe("application/json");
  });

  it("resolves multiple vars in one value", () => {
    const headers = { Custom: "${A}-${B}" };
    const env = { A: "foo", B: "bar" };
    const result = resolveConfigHeaders(headers, env);
    expect(result["Custom"]).toBe("foo-bar");
  });

  it("throws when referenced env var is not set", () => {
    const headers = { Authorization: "Bearer ${MISSING_VAR}" };
    expect(() => resolveConfigHeaders(headers, {})).toThrow(/MISSING_VAR/);
  });

  it("returns empty object for empty headers", () => {
    const result = resolveConfigHeaders({}, {});
    expect(result).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// 4. toScenarioInput — mapping to ScenarioInput
// ---------------------------------------------------------------------------

describe("toScenarioInput", () => {
  it("maps name, extraHeaders, removeHeaders, expected", () => {
    const scenario = {
      name: "auth-check",
      headers: { Authorization: "Bearer token" },
      removeHeaders: ["x-old-header"],
      expect: { result: "pass" as const, httpStatus: 200 },
    };
    const result = toScenarioInput(scenario, {});
    expect(result.name).toBe("auth-check");
    expect(result.extraHeaders["Authorization"]).toBe("Bearer token");
    expect(result.removeHeaders).toContain("x-old-header");
    expect(result.expected.result).toBe("pass");
    expect(result.expected.httpStatus).toBe(200);
  });

  it("resolves ${VAR} in scenario headers", () => {
    const scenario = {
      name: "env-auth",
      headers: { Authorization: "Bearer ${SVC_TOKEN}" },
      removeHeaders: [],
      expect: { result: "pass" as const },
    };
    const result = toScenarioInput(scenario, { SVC_TOKEN: "my-secret" });
    expect(result.extraHeaders["Authorization"]).toBe("Bearer my-secret");
  });

  it("handles scenario with no headers or removeHeaders", () => {
    const scenario = { name: "plain", expect: { result: "pass" as const } };
    const result = toScenarioInput(scenario, {});
    expect(result.extraHeaders).toEqual({});
    expect(result.removeHeaders).toEqual([]);
  });
});
