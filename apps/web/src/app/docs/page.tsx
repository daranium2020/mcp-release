import type { Metadata } from "next";
import Header from "../../components/Header";
import Footer from "../../components/Footer";
import styles from "./page.module.css";
import { DEMO_ENDPOINT, SITE_URL } from "../../lib/constants";

export const metadata: Metadata = {
  title: "Documentation",
  description:
    "How MCP Release works: protocol validation, tool schema checks, network safety, result meanings, security model, and known limitations.",
  alternates: { canonical: `${SITE_URL}/docs` },
};

export default function DocsPage() {
  return (
    <>
      <Header />
      <main className={styles.main}>
        <div className={styles.prose}>
          <h1 className={styles.pageTitle}>Documentation</h1>

          {/* Overview */}
          <section aria-labelledby="overview-heading">
            <h2 id="overview-heading" className={styles.h2}>
              Overview
            </h2>
            <p>
              MCP Release checks a remote MCP server. It verifies the
              protocol handshake, discovers available tools, validates their
              schemas, and checks network configuration. It does not invoke
              tools or require credentials.
            </p>
            <p>
              Results are structured findings classified as PASS, WARNING, or
              FAIL. Findings can be exported as JSON or Markdown.
            </p>
          </section>

          {/* Quick start */}
          <section aria-labelledby="quickstart-heading">
            <h2 id="quickstart-heading" className={styles.h2}>
              Quick start
            </h2>
            <ol className={styles.ol}>
              <li>
                Open{" "}
                <a
                  href="https://mcprelease.dev"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  mcprelease.dev
                </a>{" "}
                in a browser.
              </li>
              <li>
                Enter a public HTTPS MCP endpoint URL and click{" "}
                <strong>Run Release Check</strong>.
              </li>
              <li>
                Review the findings report. Download it as JSON or Markdown
                if needed.
              </li>
            </ol>
            <p>
              To try without a real server, use the demo endpoint:{" "}
              <code className={styles.code}>{DEMO_ENDPOINT}</code>
            </p>
          </section>

          {/* CLI */}
          <section aria-labelledby="cli-heading">
            <h2 id="cli-heading" className={styles.h2}>
              Command-line interface
            </h2>
            <p>
              The CLI supports public, private, staging, localhost, and
              authenticated MCP endpoints. Credentials stay in your
              environment and are never sent to the web app or stored.
            </p>
            <h3 className={styles.h3}>Install</h3>
            <pre className={styles.pre}>
              <code>{`npm install -g @mcp-release/cli
mcp-release --version
mcp-release check https://your-mcp-server.example.com/mcp`}</code>
            </pre>
            <h3 className={styles.h3}>Run without installing</h3>
            <pre className={styles.pre}>
              <code>{`npx -y @mcp-release/cli check https://your-mcp-server.example.com/mcp`}</code>
            </pre>
            <h3 className={styles.h3}>Local stdio server</h3>
            <p>
              The CLI can also validate MCP servers that communicate over
              stdin/stdout (spawned processes). Validation runs entirely
              locally; no data is sent to any remote service.
            </p>
            <pre className={styles.pre}>
              <code>{`# Spawn a local server and validate over stdin/stdout
mcp-release check --stdio --command "npx -y my-mcp-server"

# With a working directory
mcp-release check --stdio --command "node dist/server.js" --cwd ./packages/my-server`}</code>
            </pre>
            <p>
              For auth options (bearer tokens, custom headers, localhost),
              see{" "}
              <a href="#private-auth-heading">
                Private and authenticated servers
              </a>{" "}
              below.
            </p>
          </section>

          {/* Supported endpoints */}
          <section aria-labelledby="endpoints-heading">
            <h2 id="endpoints-heading" className={styles.h2}>
              Supported endpoint requirements
            </h2>
            <ul className={styles.ul}>
              <li>
                Must use <strong>HTTPS</strong>. HTTP endpoints are rejected
                before any connection.
              </li>
              <li>
                Must be publicly reachable. Private IP ranges, loopback,
                link-local, and cloud-metadata addresses are blocked.
              </li>
              <li>
                Must not contain embedded credentials. For example,{" "}
                <code className={styles.code}>
                  https://user:secret@host/mcp
                </code>{" "}
                is rejected.
              </li>
              <li>
                No credentials are accepted, forwarded, or stored. MCP
                Release connects as an unauthenticated client.
              </li>
            </ul>
          </section>

          {/* What is checked */}
          <section aria-labelledby="what-heading">
            <h2 id="what-heading" className={styles.h2}>
              What is checked
            </h2>
            <h3 className={styles.h3}>Protocol</h3>
            <ul className={styles.ul}>
              <li>MCP initialization handshake</li>
              <li>Protocol version negotiation</li>
              <li>Transport response codes and headers</li>
            </ul>
            <h3 className={styles.h3}>Tool schemas</h3>
            <ul className={styles.ul}>
              <li>Tool names (non-empty, valid characters)</li>
              <li>Tool descriptions (present and non-empty)</li>
              <li>
                <code className={styles.code}>inputSchema</code>: valid JSON
                Schema, compilable by Ajv
              </li>
              <li>
                <code className={styles.code}>outputSchema</code> (validated
                if present)
              </li>
              <li>Duplicate tool names</li>
            </ul>
            <h3 className={styles.h3}>Network safety (HTTP/SSE)</h3>
            <ul className={styles.ul}>
              <li>SSRF protection (RFC 1918, loopback, link-local blocked)</li>
              <li>DNS pinning (pre-resolve, validate IP, pin TCP connection)</li>
              <li>Redirect chain validation (up to 3 hops)</li>
              <li>HTTPS enforcement across all redirects</li>
            </ul>
            <h3 className={styles.h3}>Stdio transport (CLI / GitHub Action)</h3>
            <ul className={styles.ul}>
              <li>Non-JSON lines written to stdout (logs must go to stderr)</li>
              <li>Valid JSON that is not a valid MCP message</li>
              <li>Response size limit (configurable; default 10 MB)</li>
              <li>Unclean shutdown (process did not exit after stdin EOF)</li>
            </ul>
            <h3 className={styles.h3}>What is not checked</h3>
            <ul className={styles.ul}>
              <li>
                Tools are not invoked. No tool arguments are constructed or
                sent.
              </li>
              <li>
                Authenticated endpoints are not validated. No credentials are
                accepted.
              </li>
              <li>Runtime correctness of tool responses</li>
              <li>Server authorization policies or access controls</li>
            </ul>
          </section>

          {/* Result meanings */}
          <section aria-labelledby="results-heading">
            <h2 id="results-heading" className={styles.h2}>
              PASS / WARNING / FAIL
            </h2>
            <dl className={styles.dl}>
              <dt>
                <span className={`${styles.badge} ${styles.pass}`}>PASS</span>
              </dt>
              <dd>
                All checks completed without a blocking or incomplete
                condition. A PASS does not guarantee universal security or
                correctness. It means the checks MCP Release ran all passed.
              </dd>
              <dt>
                <span className={`${styles.badge} ${styles.warn}`}>
                  WARNING
                </span>
              </dt>
              <dd>
                One or more checks could not be completed or found a
                non-blocking issue. The overall result is the worst severity
                across all findings.
              </dd>
              <dt>
                <span className={`${styles.badge} ${styles.fail}`}>FAIL</span>
              </dt>
              <dd>
                One or more checks found a blocking condition. The server
                should be reviewed before production.
              </dd>
            </dl>
          </section>

          {/* Auth behavior */}
          <section aria-labelledby="auth-heading">
            <h2 id="auth-heading" className={styles.h2}>
              Authentication behavior
            </h2>
            <p>
              The web checker at mcprelease.dev does not accept credentials.
              When a server returns{" "}
              <code className={styles.code}>401</code>, MCP Release records{" "}
              <code className={styles.code}>AUTH_REQUIRED</code> (WARNING) and
              stops. This is expected: it means the server is protected, not
              broken.
            </p>
            <p>
              The CLI and GitHub Action can send credentials to the endpoint.
              Credential responses are classified as follows:
            </p>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Severity</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><code className={styles.code}>AUTH_REQUIRED</code></td>
                  <td>WARNING</td>
                  <td>401 returned, no credentials were provided</td>
                </tr>
                <tr>
                  <td><code className={styles.code}>AUTH_INVALID</code></td>
                  <td>FAIL</td>
                  <td>
                    401 with credentials (including RFC 6750{" "}
                    <code className={styles.code}>error=&quot;invalid_token&quot;</code>
                    , which covers expired, revoked, and malformed tokens)
                  </td>
                </tr>
                <tr>
                  <td><code className={styles.code}>AUTH_EXPIRED</code></td>
                  <td>FAIL</td>
                  <td>
                    401 with credentials + an unambiguous expiry code:{" "}
                    <code className={styles.code}>error=&quot;expired&quot;</code>{" "}
                    or{" "}
                    <code className={styles.code}>error=&quot;token_expired&quot;</code>
                  </td>
                </tr>
                <tr>
                  <td><code className={styles.code}>AUTH_FORBIDDEN</code></td>
                  <td>FAIL</td>
                  <td>403 Forbidden (credentials lack required permissions)</td>
                </tr>
              </tbody>
            </table>
            <p>
              <strong>Limitation:</strong>{" "}
              <code className={styles.code}>AUTH_EXPIRED</code> is only produced
              when the server returns an unambiguous, expiry-specific error code
              in the{" "}
              <code className={styles.code}>WWW-Authenticate</code> header. The
              RFC 6750 standard code{" "}
              <code className={styles.code}>error=&quot;invalid_token&quot;</code>{" "}
              produces <code className={styles.code}>AUTH_INVALID</code> because
              it covers expired, revoked, and malformed tokens and is too broad
              for an expiry-specific classification. Most OAuth 2.0 servers use{" "}
              <code className={styles.code}>invalid_token</code> and will produce{" "}
              <code className={styles.code}>AUTH_INVALID</code>. Response bodies
              and{" "}
              <code className={styles.code}>error_description</code> fields are
              never read or included in reports.
            </p>
          </section>

          {/* Rate limiting and resilience */}
          <section aria-labelledby="resilience-heading">
            <h2 id="resilience-heading" className={styles.h2}>
              Rate limiting and resilience (CLI, v0.3.0)
            </h2>
            <h3 className={styles.h3}>429 and Retry-After</h3>
            <p>
              When a server returns{" "}
              <code className={styles.code}>429 Too Many Requests</code>, MCP
              Release records <code className={styles.code}>RATE_LIMITED</code>{" "}
              (FAIL). If a{" "}
              <code className={styles.code}>Retry-After</code> header is
              present, it is parsed as either integer seconds (e.g.{" "}
              <code className={styles.code}>Retry-After: 30</code>) or an HTTP
              date (e.g.{" "}
              <code className={styles.code}>
                Retry-After: Wed, 21 Oct 2026 07:28:00 GMT
              </code>
              ). Retry-After values exceeding 60 seconds are capped at 60
              seconds. Unparseable values produce{" "}
              <code className={styles.code}>RETRY_AFTER_INVALID</code>{" "}
              (WARNING).
            </p>
            <h3 className={styles.h3}>Timeout types</h3>
            <ul className={styles.ul}>
              <li>
                <code className={styles.code}>CONNECT_TIMEOUT</code>: TCP
                connection could not be established within the timeout.
              </li>
              <li>
                <code className={styles.code}>RESPONSE_TIMEOUT</code>: TCP
                connection was established but the server did not send a
                response within the configured response timeout.
              </li>
            </ul>
            <h3 className={styles.h3}>Retry rules</h3>
            <p>
              Retries are <strong>off by default</strong>. Each failure category
              must be explicitly listed in{" "}
              <code className={styles.code}>retries.retryOn</code>, and{" "}
              <code className={styles.code}>retries.maxAttempts</code> must be
              greater than 1. Without both, no retries occur.
            </p>
            <ul className={styles.ul}>
              <li>
                <code className={styles.code}>rate-limit</code>: retry HTTP 429.
                Honours the server{"`"}s <code className={styles.code}>Retry-After</code>{" "}
                header (integer seconds or HTTP date), capped at 60 seconds.
              </li>
              <li>
                <code className={styles.code}>server-error</code>: retry 5xx responses.
              </li>
              <li>
                <code className={styles.code}>connection-failure</code>: retry
                connect failures and connect timeouts.
              </li>
              <li>
                <code className={styles.code}>response-timeout</code>: retry
                when the server connected but did not respond in time.
              </li>
              <li>
                401, 403, 400, schema errors, malformed MCP responses, and
                scenario timeouts are never retried regardless of configuration.
              </li>
            </ul>
          </section>

          {/* Private and authenticated servers */}
          <section aria-labelledby="private-auth-heading">
            <h2 id="private-auth-heading" className={styles.h2}>
              Private and authenticated servers
            </h2>
            <p>
              The web checker at{" "}
              <a
                href="https://mcprelease.dev"
                target="_blank"
                rel="noopener noreferrer"
              >
                mcprelease.dev
              </a>{" "}
              supports public HTTPS endpoints only. It does not accept
              credentials of any kind, and it cannot reach private networks or
              localhost. If your server returns{" "}
              <code className={styles.code}>AUTH_REQUIRED</code>, the web
              checker cannot validate it further.
            </p>
            <p>
              For private, staging, localhost, or authenticated MCP endpoints,
              use the <strong>CLI</strong> or{" "}
              <strong>GitHub Action</strong>. Both run in your own environment
              so credentials never leave your machine or CI secrets store.
            </p>
            <h3 className={styles.h3}>CLI</h3>
            <pre className={styles.pre}>
              <code>{`# Bearer token from an environment variable (recommended for secrets)
MCP_TOKEN=your-token mcp-release check https://staging.example.com/mcp \\
  --bearer-token-env MCP_TOKEN

# Literal header (for non-secret values)
mcp-release check https://staging.example.com/mcp \\
  --header "X-Tenant-Id: acme"

# Localhost or private network endpoint
mcp-release check http://localhost:4000/mcp --allow-http`}</code>
            </pre>
            <h3 className={styles.h3}>GitHub Action</h3>
            <pre className={styles.pre}>
              <code>{`- name: Validate MCP server
  uses: daranium2020/mcp-release@v0.2.1
  with:
    endpoint: https://staging.example.com/mcp
    bearer-token-env: MCP_TOKEN
  env:
    MCP_TOKEN: \${{ secrets.MCP_TOKEN }}`}</code>
            </pre>
            <ul className={styles.ul}>
              <li>
                Credentials stay in your local environment or CI secrets.
                They are not sent to the web app or stored anywhere.
              </li>
              <li>
                MCP Release still discovers tools but never executes them.
                No tool arguments are constructed or sent.
              </li>
              <li>
                A PASS result does not guarantee security or correctness. It
                reflects the checks MCP Release ran.
              </li>
            </ul>
          </section>

          {/* Configuration file (v0.3.0) */}
          <section aria-labelledby="config-file-heading">
            <h2 id="config-file-heading" className={styles.h2}>
              Configuration file (CLI, v0.3.0)
            </h2>
            <p>
              The CLI and GitHub Action support a YAML configuration file for
              running multiple named scenarios (authenticated,
              unauthenticated, and expected-failure) in a single
              command.
            </p>
            <pre className={styles.pre}>
              <code>{`# mcp-release.config.yml
version: "1"
endpoint: "https://api.example.com/mcp"
headers:
  Authorization: "Bearer \${MCP_TOKEN}"   # resolved from environment at runtime

timeouts:
  connectMs: 5000
  responseMs: 10000

retries:
  maxAttempts: 3
  backoffMs: 1000
  retryOn:           # retries disabled by default
    - rate-limit     # retry HTTP 429
    - server-error   # retry 5xx

scenarios:
  - name: authenticated-pass
    expect:
      result: pass

  - name: missing-auth
    headers: {}               # override: send no credentials
    removeHeaders:
      - Authorization
    expect:
      httpStatus: 401         # expect 401 AUTH_REQUIRED (a negative test)

  - name: read-only-resource
    headers:
      Authorization: "Bearer \${READ_ONLY_TOKEN}"
    expect:
      result: pass`}</code>
            </pre>
            <h3 className={styles.h3}>Environment variable substitution</h3>
            <p>
              Header values containing{" "}
              <code className={styles.code}>{`\${VAR_NAME}`}</code> are
              resolved from the process environment at runtime, never at parse
              time. If a variable is unset, the literal placeholder is sent and
              the server will likely respond with{" "}
              <code className={styles.code}>AUTH_INVALID</code>.
            </p>
            <h3 className={styles.h3}>Scenario expectations</h3>
            <p>
              Each scenario has an <code className={styles.code}>expect</code>{" "}
              block. Both fields are optional and independent:
            </p>
            <ul className={styles.ul}>
              <li>
                <code className={styles.code}>result: pass</code>: the overall
                check must produce PASS; any FAIL finding causes a mismatch.
              </li>
              <li>
                <code className={styles.code}>result: fail</code>: the check
                must produce at least one FAIL finding (useful for negative
                tests).
              </li>
              <li>
                <code className={styles.code}>httpStatus: 401</code>: the
                inferred HTTP status must match (see Auth finding codes above).
              </li>
            </ul>
            <p>
              When the actual outcome does not match, MCP Release adds{" "}
              <code className={styles.code}>AUTH_SCENARIO_MISMATCH</code>{" "}
              (FAIL) to the findings and the overall config run status is FAIL.
            </p>
            <h3 className={styles.h3}>Running config scenarios</h3>
            <pre className={styles.pre}>
              <code>{`# Terminal report (default)
mcp-release check --config mcp-release.config.yml

# JSON report
mcp-release check --config mcp-release.config.yml --json

# Markdown report
mcp-release check --config mcp-release.config.yml --markdown`}</code>
            </pre>
            <h3 className={styles.h3}>GitHub Actions integration</h3>
            <pre className={styles.pre}>
              <code>{`- name: Validate MCP server scenarios
  uses: daranium2020/mcp-release@v0.3.0
  with:
    config: mcp-release.config.yml
  env:
    MCP_TOKEN: \${{ secrets.MCP_TOKEN }}
    READ_ONLY_TOKEN: \${{ secrets.READ_ONLY_TOKEN }}`}</code>
            </pre>
          </section>

          {/* Security model */}
          <section aria-labelledby="security-heading">
            <h2 id="security-heading" className={styles.h2}>
              Security model
            </h2>
            <h3 className={styles.h3}>Web checker (mcprelease.dev)</h3>
            <ul className={styles.ul}>
              <li>
                Only public HTTPS endpoints are accepted. HTTP is rejected
                before any connection.
              </li>
              <li>
                Private, loopback, link-local (169.254.0.0/16), and
                cloud-metadata (169.254.169.254) destinations are blocked at
                the DNS level.
              </li>
              <li>
                DNS pinning closes the TOCTOU gap. The resolved IP is pinned
                at connection time.
              </li>
              <li>
                Redirects are re-validated at each hop. HTTPS applies across
                all redirects.
              </li>
              <li>
                No endpoint credentials are accepted, forwarded, or stored.
              </li>
              <li>
                Remote response bodies are never included in findings.
              </li>
              <li>
                TLS verification is enforced (
                <code className={styles.code}>rejectUnauthorized: true</code>).
              </li>
              <li>
                Error messages are redacted. Token patterns, URL-embedded
                credentials, and{" "}
                <code className={styles.code}>WWW-Authenticate</code> header
                values are stripped before being returned.
              </li>
              <li>
                Tools are discovered via{" "}
                <code className={styles.code}>tools/list</code> but never
                invoked. No arguments are constructed or sent.
              </li>
            </ul>
            <h3 className={styles.h3}>CLI and GitHub Action</h3>
            <ul className={styles.ul}>
              <li>
                Credentials are sent only to the configured MCP endpoint. They
                are never sent to or stored by MCP Release.
              </li>
              <li>
                Scenario execution and report generation run locally in the CLI
                or GitHub Actions runner.
              </li>
              <li>
                Environment variable values used in header substitution are
                never logged or included in reports.
              </li>
              <li>
                SSRF protections apply to all endpoints checked via the web app.
                The CLI and GitHub Action connect to arbitrary configured
                endpoints; apply allow-listing and network controls in your own
                environment as appropriate.
              </li>
            </ul>
          </section>

          {/* Report exports */}
          <section aria-labelledby="exports-heading">
            <h2 id="exports-heading" className={styles.h2}>
              Report exports
            </h2>
            <p>
              Reports can be exported in three formats. All formats carry the
              same finding codes, severities, and scenario data.
            </p>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Format</th>
                  <th>Flag</th>
                  <th>Use</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Terminal</td>
                  <td><em>(default)</em></td>
                  <td>Human-readable colored output</td>
                </tr>
                <tr>
                  <td>JSON</td>
                  <td><code className={styles.code}>--json</code></td>
                  <td>Machine-readable; CI pipelines and automated tooling</td>
                </tr>
                <tr>
                  <td>Markdown</td>
                  <td><code className={styles.code}>--markdown</code></td>
                  <td>GitHub PR summaries and release notes</td>
                </tr>
              </tbody>
            </table>
            <p>
              The JSON schema version is{" "}
              <code className={styles.code}>&quot;1&quot;</code>. Single-check
              and config-run reports use a consistent schema; config runs add a{" "}
              <code className={styles.code}>scenarios</code> array with
              per-scenario results. All fields are documented in the repository.
            </p>
          </section>

          {/* Known limitations */}
          <section aria-labelledby="limitations-heading">
            <h2 id="limitations-heading" className={styles.h2}>
              Known limitations
            </h2>
            <ul className={styles.ul}>
              <li>
                <strong>Web checker: public HTTPS endpoints only.</strong> HTTP
                and private network endpoints are rejected. Use the CLI or
                GitHub Action for localhost, staging, and private endpoints.
              </li>
              <li>
                <strong>Web checker: no credential input.</strong> Authenticated
                checks are not performed. Use the CLI with{" "}
                <code className={styles.code}>--header</code> or a config file
                for authenticated scenarios.
              </li>
              <li>
                <strong>AUTH_EXPIRED requires an unambiguous expiry code.</strong>{" "}
                The RFC 6750 standard code{" "}
                <code className={styles.code}>error=&quot;invalid_token&quot;</code>{" "}
                produces <code className={styles.code}>AUTH_INVALID</code> because
                it covers expired, revoked, and malformed tokens. Only{" "}
                <code className={styles.code}>error=&quot;expired&quot;</code>{" "}
                and{" "}
                <code className={styles.code}>error=&quot;token_expired&quot;</code>{" "}
                produce <code className={styles.code}>AUTH_EXPIRED</code>. Most
                OAuth 2.0 servers will produce{" "}
                <code className={styles.code}>AUTH_INVALID</code>. Response bodies
                are never inspected.
              </li>
              <li>
                <strong>Tools are not invoked.</strong> Runtime correctness of
                tool responses is not validated.
              </li>
              <li>
                <strong>A PASS is not a security guarantee.</strong> It
                reflects the checks MCP Release ran. Runtime behavior may
                differ in other environments.
              </li>
              <li>
                <strong>In-memory rate limiting (web checker).</strong>{" "}
                Per-process only; not shared across scaled instances.
              </li>
              <li>
                <strong>No persistent storage.</strong> Web checker reports are
                not saved server-side. Export before closing the tab.
              </li>
            </ul>
          </section>

          {/* Privacy and data handling */}
          <section aria-labelledby="privacy-heading">
            <h2 id="privacy-heading" className={styles.h2}>
              Privacy and data handling
            </h2>
            <p>
              MCP Release does not store endpoint URLs, request bodies,
              reports, or validation results. Findings are returned to the
              browser in the HTTP response and are not retained server-side.
              Export or save them before closing the tab.
            </p>
            <p>
              The application does not request, accept, or store credentials.
              Validation connects as an unauthenticated client. Discovered
              tools are listed but never executed; no tool arguments are
              constructed or sent.
            </p>
            <p>
              JSON and Markdown exports are generated from the report data
              returned in the response. They are not transmitted to any
              external service.
            </p>
            <p>
              Transport diagnostic errors are logged server-side at the time of
              the request. As with all hosted applications, the hosting provider
              may retain operational logs including request metadata and error
              diagnostics. The repository does not configure a specific
              retention period for those logs.
            </p>
            <p>
              Questions or concerns:{" "}
              <a href="mailto:feedback@mcprelease.dev">
                feedback@mcprelease.dev
              </a>
            </p>
          </section>

          {/* Demo endpoint */}
          <section aria-labelledby="demo-heading">
            <h2 id="demo-heading" className={styles.h2}>
              Demo endpoint
            </h2>
            <p>
              A public fixture server is available for testing MCP Release
              itself:
            </p>
            <pre className={styles.pre}>
              <code>{DEMO_ENDPOINT}</code>
            </pre>
            <p>
              This server is deterministic, unauthenticated, and has no
              external dependencies. Checking it should return{" "}
              <strong>PASS</strong> with two tools:{" "}
              <code className={styles.code}>echo</code> and{" "}
              <code className={styles.code}>ping</code>.
            </p>
          </section>

          {/* Local development */}
          <section aria-labelledby="local-dev-heading">
            <h2 id="local-dev-heading" className={styles.h2}>
              Local development
            </h2>
            <pre className={styles.pre}>
              <code>{`# Install dependencies
pnpm install

# Start the web app
pnpm --filter @mcp-release/web dev

# Run all tests
pnpm test

# Type-check all packages
pnpm typecheck

# Lint
pnpm lint`}</code>
            </pre>
            <p>
              The development server starts on{" "}
              <code className={styles.code}>http://localhost:3000</code>.
              Dev-only fixture buttons (PASS / FAIL / WARNING) are visible in
              development and removed in production builds.
            </p>
          </section>

          {/* GitHub Action */}
          <section aria-labelledby="action-heading">
            <h2 id="action-heading" className={styles.h2}>
              GitHub Action
            </h2>
            <p>
              A GitHub Action is available at{" "}
              <code className={styles.code}>
                daranium2020/mcp-release
              </code>{" "}
              to run MCP Release checks in CI:
            </p>
            <pre className={styles.pre}>
              <code>{`# HTTP/SSE endpoint
- uses: daranium2020/mcp-release@v0.2.1
  with:
    endpoint: https://your-mcp-server.example.com/mcp
    fail-on: fail        # optional: fail (default) | warning
    timeout-ms: 10000    # optional: 1000-30000

# Local stdio server (spawned process)
- uses: daranium2020/mcp-release@v0.2.1
  with:
    transport: stdio
    command: npx -y my-mcp-server
    fail-on: fail`}</code>
            </pre>
            <p>
              The action annotates the job with findings and writes a summary
              to the GitHub Actions job summary. Exit code is{" "}
              <code className={styles.code}>0</code> when the result is below
              the threshold and <code className={styles.code}>1</code> when
              the threshold is met or exceeded.
            </p>
            <p>
              See the repository for the full action manifest and inputs.
            </p>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
