import { describe, it, expect } from "vitest";
import {
  redactHeaders,
  redactUrl,
  redactString,
  redactErrorMessage,
} from "../src/redact.js";

describe("redactHeaders", () => {
  it("redacts authorization header", () => {
    const result = redactHeaders({ Authorization: "Bearer abc123" });
    expect(result["Authorization"]).toBe("[REDACTED]");
  });

  it("redacts x-api-key header (case insensitive)", () => {
    const result = redactHeaders({ "x-api-key": "sk-secret" });
    expect(result["x-api-key"]).toBe("[REDACTED]");
  });

  it("preserves non-sensitive headers", () => {
    const result = redactHeaders({ "content-type": "application/json" });
    expect(result["content-type"]).toBe("application/json");
  });
});

describe("redactUrl", () => {
  it("redacts token query params", () => {
    const url = "https://example.com/mcp?token=abc123&normal=value";
    const result = redactUrl(url);
    expect(result).toContain("token=[REDACTED]");
    expect(result).toContain("normal=value");
  });

  it("redacts api_key params", () => {
    const url = "https://example.com/mcp?api_key=secret";
    const result = redactUrl(url);
    expect(result).toContain("api_key=[REDACTED]");
  });

  it("preserves clean URLs unchanged", () => {
    const url = "https://example.com/mcp";
    expect(redactUrl(url)).toBe(url);
  });
});

describe("redactString", () => {
  it("redacts bearer tokens", () => {
    const result = redactString("Authorization: Bearer abc123xyz");
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("abc123xyz");
  });

  it("leaves clean strings unchanged", () => {
    const result = redactString("Connection failed: timeout");
    expect(result).toBe("Connection failed: timeout");
  });
});

describe("redactErrorMessage", () => {
  it("redacts from Error objects", () => {
    const err = new Error("token=supersecret connection failed");
    const result = redactErrorMessage(err);
    expect(result).not.toContain("supersecret");
  });

  it("handles non-Error objects", () => {
    const result = redactErrorMessage("plain string error");
    expect(typeof result).toBe("string");
  });
});
