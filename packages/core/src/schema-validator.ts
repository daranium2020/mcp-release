import { Ajv, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";

// Default schema draft when $schema is absent in MCP tool schemas.
// MCP spec currently targets JSON Schema draft-07 behavior.
const DEFAULT_SCHEMA_DRAFT = "http://json-schema.org/draft-07/schema#";

const SUPPORTED_SCHEMA_DRAFTS = new Set([
  "http://json-schema.org/draft-04/schema#",
  "http://json-schema.org/draft-06/schema#",
  "http://json-schema.org/draft-07/schema#",
  "https://json-schema.org/draft/2019-09/schema",
  "https://json-schema.org/draft/2020-12/schema",
]);

type SchemaValidationResult =
  | { valid: true; isUnsupportedDraft?: undefined; errors?: undefined }
  | { valid: false; errors: string[]; isUnsupportedDraft?: boolean };

function makeAjv(): Ajv {
  const ajv = new Ajv({
    strict: false,
    allErrors: true,
    validateSchema: true,
    addUsedSchema: false,
  });
  // ajv-formats types are not perfectly aligned with ajv v8's generic signature;
  // cast is safe because addFormats only adds keyword/format definitions.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addFormats(ajv as any);
  return ajv;
}

export function validateJsonSchema(
  schema: unknown,
  context: string,
): SchemaValidationResult {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    return { valid: false, errors: [`${context}: must be a JSON Schema object`] };
  }

  const schemaObj = schema as Record<string, unknown>;
  const declared = schemaObj["$schema"];

  if (declared !== undefined && typeof declared === "string") {
    if (!SUPPORTED_SCHEMA_DRAFTS.has(declared)) {
      return {
        valid: false,
        errors: [
          `${context}: unsupported $schema draft "${declared}". Supported: ${[...SUPPORTED_SCHEMA_DRAFTS].join(", ")}`,
        ],
        isUnsupportedDraft: true,
      };
    }
  }

  // Inject default $schema for compilation if not present
  const schemaForCompile: Record<string, unknown> =
    declared !== undefined
      ? schemaObj
      : { ...schemaObj, $schema: DEFAULT_SCHEMA_DRAFT };

  const ajv = makeAjv();

  let validate: ValidateFunction;
  try {
    validate = ajv.compile(schemaForCompile);
    void validate;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { valid: false, errors: [`${context}: schema compilation failed: ${msg}`] };
  }

  const metaValid = ajv.validateSchema(schemaForCompile);
  if (!metaValid) {
    const errors = (ajv.errors ?? []).map(
      (e) => `${context}: ${e.instancePath} ${e.message ?? "unknown error"}`,
    );
    return { valid: false, errors };
  }

  return { valid: true };
}

export { DEFAULT_SCHEMA_DRAFT, SUPPORTED_SCHEMA_DRAFTS };
