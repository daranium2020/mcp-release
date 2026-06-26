import { describe, it, expect } from "vitest";
import { validateJsonSchema } from "../src/schema-validator.js";

describe("validateJsonSchema", () => {
  it("accepts a valid JSON Schema object", () => {
    const result = validateJsonSchema(
      { type: "object", properties: { foo: { type: "string" } } },
      "test",
    );
    expect(result.valid).toBe(true);
  });

  it("accepts an empty object (valid permissive schema)", () => {
    const result = validateJsonSchema({}, "test");
    expect(result.valid).toBe(true);
  });

  it("rejects a non-object (string)", () => {
    const result = validateJsonSchema("not a schema", "test");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("must be a JSON Schema object");
  });

  it("rejects null", () => {
    const result = validateJsonSchema(null, "test");
    expect(result.valid).toBe(false);
  });

  it("rejects an array", () => {
    const result = validateJsonSchema([], "test");
    expect(result.valid).toBe(false);
  });

  it("accepts draft-07 $schema declaration", () => {
    const result = validateJsonSchema(
      {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
      },
      "test",
    );
    expect(result.valid).toBe(true);
  });

  it("warns on unsupported $schema draft", () => {
    const result = validateJsonSchema(
      {
        $schema: "http://json-schema.org/draft-03/schema#",
        type: "object",
      },
      "test",
    );
    expect(result.valid).toBe(false);
    expect(result.isUnsupportedDraft).toBe(true);
  });
});
