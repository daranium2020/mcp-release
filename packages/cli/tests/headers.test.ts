/**
 * Unit tests for CLI header parsing and validation.
 * These test the core/headers module from the CLI's perspective.
 */
import { describe, it, expect } from "vitest";
import {
  validateHeaderName,
  validateHeaderValue,
  parseHeaderLiteralFlag,
  parseHeaderEnvFlag,
  buildRequestHeaders,
  HeaderValidationError,
} from "@mcp-release/core";

describe("CLI header parsing — validateHeaderName", () => {
  it("accepts alphanumeric names", () => {
    expect(() => validateHeaderName("Authorization")).not.toThrow();
    expect(() => validateHeaderName("X-API-Key")).not.toThrow();
    expect(() => validateHeaderName("x-custom-123")).not.toThrow();
  });

  it("rejects empty string", () => {
    expect(() => validateHeaderName("")).toThrow(HeaderValidationError);
  });

  it("rejects name with spaces (header injection protection)", () => {
    expect(() => validateHeaderName("Bad Name")).toThrow(HeaderValidationError);
  });

  it("rejects name with newline (header injection protection)", () => {
    expect(() => validateHeaderName("X-Header\nInjection")).toThrow(
      HeaderValidationError,
    );
  });
});

describe("CLI header parsing — validateHeaderValue", () => {
  it("accepts typical auth values", () => {
    expect(() =>
      validateHeaderValue("Authorization", "Bearer abc.def.ghi"),
    ).not.toThrow();
    expect(() => validateHeaderValue("X-API-Key", "sk-1234abcd")).not.toThrow();
  });

  it("rejects value with CR (\\r) — header injection prevention", () => {
    expect(() =>
      validateHeaderValue("X-Header", "value\rX-Injected: evil"),
    ).toThrow(HeaderValidationError);
  });

  it("rejects value with LF (\\n) — header injection prevention", () => {
    expect(() =>
      validateHeaderValue("X-Header", "value\nX-Injected: evil"),
    ).toThrow(HeaderValidationError);
  });
});

describe("CLI header parsing — parseHeaderLiteralFlag (--header)", () => {
  it('parses "Authorization: Bearer token123"', () => {
    const [name, value] = parseHeaderLiteralFlag("Authorization: Bearer token123");
    expect(name).toBe("Authorization");
    expect(value).toBe("Bearer token123");
  });

  it('parses "X-API-Key: sk-secret"', () => {
    const [name, value] = parseHeaderLiteralFlag("X-API-Key: sk-secret");
    expect(name).toBe("X-API-Key");
    expect(value).toBe("sk-secret");
  });

  it("trims leading/trailing whitespace from name and value", () => {
    const [name, value] = parseHeaderLiteralFlag("  X-Custom  :  padded-value  ");
    expect(name).toBe("X-Custom");
    expect(value).toBe("padded-value");
  });

  it("throws on missing colon", () => {
    expect(() => parseHeaderLiteralFlag("No-Colon-Here")).toThrow(
      HeaderValidationError,
    );
  });

  it("throws on empty string", () => {
    expect(() => parseHeaderLiteralFlag("")).toThrow(HeaderValidationError);
  });
});

describe("CLI header parsing — parseHeaderEnvFlag (--header-env)", () => {
  it("reads header value from environment variable", () => {
    const env = { MY_API_TOKEN: "secret-value-xyz" };
    const [name, value] = parseHeaderEnvFlag("X-API-Key=MY_API_TOKEN", env);
    expect(name).toBe("X-API-Key");
    expect(value).toBe("secret-value-xyz");
  });

  it("throws when the referenced env var is not set", () => {
    expect(() =>
      parseHeaderEnvFlag("Authorization=UNSET_VAR", {}),
    ).toThrow(HeaderValidationError);
  });

  it("throws when format has no '=' separator", () => {
    expect(() =>
      parseHeaderEnvFlag("AuthorizationTOKEN_VAR", {}),
    ).toThrow(HeaderValidationError);
  });

  it("error message includes the env var name (for debugging)", () => {
    try {
      parseHeaderEnvFlag("Authorization=MY_MISSING_VAR", {});
    } catch (err) {
      expect(err).toBeInstanceOf(HeaderValidationError);
      expect((err as HeaderValidationError).message).toContain("MY_MISSING_VAR");
    }
  });
});

describe("CLI header parsing — buildRequestHeaders (combined)", () => {
  it("returns empty object when no flags are provided", () => {
    const headers = buildRequestHeaders([], [], undefined, {});
    expect(headers).toEqual({});
  });

  it("builds headers from --header literals", () => {
    const headers = buildRequestHeaders(
      ["X-Custom: val1", "X-Other: val2"],
      [],
      undefined,
      {},
    );
    expect(headers).toMatchObject({ "X-Custom": "val1", "X-Other": "val2" });
  });

  it("builds Authorization from --bearer-token-env", () => {
    const headers = buildRequestHeaders([], [], "MY_TOKEN", {
      MY_TOKEN: "bearer-xyz",
    });
    expect(headers["Authorization"]).toBe("Bearer bearer-xyz");
  });

  it("--bearer-token-env overrides a --header Authorization", () => {
    const headers = buildRequestHeaders(
      ["Authorization: Bearer old"],
      [],
      "MY_TOKEN",
      { MY_TOKEN: "new-token" },
    );
    expect(headers["Authorization"]).toBe("Bearer new-token");
  });

  it("throws when --bearer-token-env references a missing var", () => {
    expect(() => buildRequestHeaders([], [], "NOT_SET", {})).toThrow(
      HeaderValidationError,
    );
  });

  it("sensitive values are NOT exposed by the error — error contains var name, not value", () => {
    const env = { SECRET: "super-secret-value" };
    try {
      buildRequestHeaders([], [], "NOT_SET", env);
    } catch (err) {
      expect((err as Error).message).not.toContain("super-secret-value");
    }
  });
});
