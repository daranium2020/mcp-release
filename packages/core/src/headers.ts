/**
 * HTTP request header validation and construction utilities.
 *
 * Used by the CLI and GitHub Action to validate and build request headers
 * before passing them to the core validator. Never logs or exposes header
 * values; callers are responsible for redacting sensitive values in output.
 */

// RFC 7230 §3.2.6: HTTP token characters
const HTTP_TOKEN_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export class HeaderValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HeaderValidationError";
  }
}

export function validateHeaderName(name: string): void {
  if (name === "") {
    throw new HeaderValidationError("Header name must not be empty");
  }
  if (!HTTP_TOKEN_RE.test(name)) {
    throw new HeaderValidationError(
      `Invalid header name "${name}": must be a valid HTTP token (RFC 7230)`,
    );
  }
}

export function validateHeaderValue(name: string, value: string): void {
  if (/[\r\n]/.test(value)) {
    throw new HeaderValidationError(
      `Header "${name}" value must not contain CR (\\r) or LF (\\n)`,
    );
  }
}

/**
 * Parse a "--header" flag in "Name: value" format.
 * Returns [name, value] after validation.
 */
export function parseHeaderLiteralFlag(flag: string): [string, string] {
  const colonIdx = flag.indexOf(":");
  if (colonIdx < 1) {
    throw new HeaderValidationError(
      `Invalid --header value: "${flag}" (expected "Name: value")`,
    );
  }
  const name = flag.slice(0, colonIdx).trim();
  const value = flag.slice(colonIdx + 1).trim();
  validateHeaderName(name);
  validateHeaderValue(name, value);
  return [name, value];
}

/**
 * Parse a "--header-env" flag in "Name=ENV_VAR" format.
 * Reads the value from env and returns [name, value] after validation.
 * Throws HeaderValidationError if the variable is not set.
 */
export function parseHeaderEnvFlag(
  flag: string,
  env: Record<string, string | undefined>,
): [string, string] {
  const eqIdx = flag.indexOf("=");
  if (eqIdx < 1) {
    throw new HeaderValidationError(
      `Invalid --header-env value: "${flag}" (expected "Name=ENV_VAR")`,
    );
  }
  const name = flag.slice(0, eqIdx).trim();
  const varName = flag.slice(eqIdx + 1).trim();
  validateHeaderName(name);
  if (varName === "") {
    throw new HeaderValidationError(
      `Invalid --header-env value: "${flag}": environment variable name must not be empty`,
    );
  }
  const value = env[varName];
  if (value === undefined) {
    throw new HeaderValidationError(
      `Environment variable "${varName}" (for header "${name}") is not set`,
    );
  }
  validateHeaderValue(name, value);
  return [name, value];
}

/**
 * Build a headers record from CLI/Action flag arrays.
 *
 * Processes (in order): literal headers, env-based headers, bearer token.
 * Later entries overwrite earlier ones for the same header name.
 * Throws HeaderValidationError for any invalid input or missing env var.
 *
 * Security contract: this function never prints or logs header values.
 */
export function buildRequestHeaders(
  headerLiterals: string[],
  headerEnvFlags: string[],
  bearerTokenEnv: string | undefined,
  env: Record<string, string | undefined>,
): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const flag of headerLiterals) {
    const [name, value] = parseHeaderLiteralFlag(flag);
    headers[name] = value;
  }

  for (const flag of headerEnvFlags) {
    const [name, value] = parseHeaderEnvFlag(flag, env);
    headers[name] = value;
  }

  if (bearerTokenEnv !== undefined) {
    const token = env[bearerTokenEnv];
    if (token === undefined) {
      throw new HeaderValidationError(
        `Environment variable "${bearerTokenEnv}" (for --bearer-token-env) is not set`,
      );
    }
    if (/[\r\n]/.test(token)) {
      throw new HeaderValidationError(
        `Bearer token from "${bearerTokenEnv}" must not contain CR or LF`,
      );
    }
    headers["Authorization"] = `Bearer ${token}`;
  }

  return headers;
}
