import Header from "../components/Header";
import Footer from "../components/Footer";
import CheckClient from "../components/CheckClient";
import styles from "./page.module.css";
import { DEMO_ENDPOINT } from "../lib/constants";

export default function HomePage() {
  return (
    <>
      <Header />
      <main className={styles.main}>
        {/* Hero */}
        <section className={styles.hero} aria-labelledby="headline">
          <h1 id="headline" className={styles.headline}>
            Check an MCP server before release.
          </h1>
          <p className={styles.subhead}>
            Verify the protocol handshake, tool schemas, and stdio transport
            behavior. Supports HTTP/SSE remote servers and local spawned
            processes. MCP Release does not execute tools.
          </p>
          <a href="/docs" className={styles.docsLink}>
            View documentation
          </a>
        </section>

        {/* Check form */}
        <CheckClient demoEndpoint={DEMO_ENDPOINT} />

        {/* Three ways to use */}
        <section
          className={styles.section}
          aria-labelledby="ways-heading"
        >
          <h2 id="ways-heading" className={styles.sectionHeading}>
            Three ways to use MCP Release
          </h2>
          <ul className={styles.waysGrid}>
            <li className={styles.wayCard}>
              <span className={styles.wayLabel}>Browser</span>
              <span className={styles.wayDesc}>
                Public HTTPS endpoint validation. No install required. No
                credentials accepted or stored.
              </span>
            </li>
            <li className={styles.wayCard}>
              <span className={styles.wayLabel}>CLI</span>
              <span className={styles.wayDesc}>
                Local, private, authenticated, localhost, and stdio servers.
                Credentials stay on your machine.
              </span>
            </li>
            <li className={styles.wayCard}>
              <span className={styles.wayLabel}>GitHub Actions</span>
              <span className={styles.wayDesc}>
                Automated MCP validation in CI. Secrets stay in GitHub
                secrets and are never sent to MCP Release.
              </span>
            </li>
          </ul>
        </section>

        {/* Release scenarios — v0.3.0 */}
        <section
          className={styles.section}
          aria-labelledby="scenarios-heading"
        >
          <h2 id="scenarios-heading" className={styles.sectionHeading}>
            Release scenarios
            <span className={styles.versionBadge}>New in v0.3.0</span>
          </h2>
          <p className={styles.demoDesc}>
            Define multiple named scenarios in a YAML config file and validate
            them in one run — authenticated success, expected auth failures,
            rate limits, retries, and timeout resilience.
          </p>
          <ul className={styles.featureList}>
            <li>Authenticated success via Bearer token or custom headers</li>
            <li>Missing, invalid, expired, and forbidden credentials</li>
            <li>Expected negative responses with defined <code className={styles.inlineCode}>expect</code> blocks</li>
            <li>Rate limits and Retry-After header handling</li>
            <li>Explicit retries with configurable backoff</li>
            <li>Connect, response, and total scenario timeouts</li>
          </ul>
          <p className={styles.preLabel}>CLI:</p>
          <pre className={styles.pre}>
            <code className={styles.preCode}>{`mcp-release check --config mcp-release.config.yml`}</code>
          </pre>
          <p className={styles.preLabel}>Example config (mcp-release.config.yml):</p>
          <pre className={styles.pre}>
            <code className={styles.preCode}>{`version: 1
endpoint: https://your-mcp-server.example.com/mcp

scenarios:
  - name: authenticated
    headers:
      Authorization: "Bearer \${MCP_TOKEN}"
    expect:
      result: pass

  - name: anonymous
    expect:
      result: warning
      httpStatus: 401`}</code>
          </pre>
          <p className={styles.preLabel}>Retry configuration:</p>
          <pre className={styles.pre}>
            <code className={styles.preCode}>{`retries:
  maxAttempts: 3
  backoffMs: 1000
  retryOn:
    - rate-limit
    - server-error
    - connection-failure
    - response-timeout`}</code>
          </pre>
        </section>

        {/* Local stdio validation */}
        <section
          className={styles.section}
          aria-labelledby="stdio-heading"
        >
          <h2 id="stdio-heading" className={styles.sectionHeading}>
            Local stdio validation
          </h2>
          <p className={styles.demoDesc}>
            Available since v0.2.0. MCP Release can spawn and validate any MCP
            server that communicates over stdin/stdout. Pass a command string;
            MCP Release starts the process, performs MCP initialization,
            discovers tools, validates schemas, and shuts down cleanly.
          </p>
          <p className={styles.stdioNote}>
            Validation runs entirely on your machine or GitHub Actions runner.
            No stdio validation data is sent to MCP Release servers. The
            spawned process, its output, and all findings stay local.
          </p>
          <p className={styles.preLabel}>What it checks:</p>
          <ul className={styles.featureList}>
            <li>MCP initialization handshake and protocol negotiation</li>
            <li>Tool discovery and schema validation</li>
            <li>Unexpected output on stdout (logs must go to stderr)</li>
            <li>Malformed MCP messages on stdout</li>
            <li>Response size limit</li>
            <li>Startup timeout</li>
            <li>Clean shutdown after stdin EOF</li>
          </ul>
          <p className={styles.preLabel}>CLI:</p>
          <pre className={styles.pre}>
            <code className={styles.preCode}>{`npx -y @mcp-release/cli check --stdio --command "npx -y my-mcp-server"

# With a working directory
npx -y @mcp-release/cli check --stdio --command "node dist/server.js" --cwd ./my-server`}</code>
          </pre>
          <p className={styles.preLabel}>GitHub Actions:</p>
          <pre className={styles.pre}>
            <code className={styles.preCode}>{`- uses: daranium2020/mcp-release@v0.3.0
  with:
    transport: stdio
    command: npx -y my-mcp-server`}</code>
          </pre>
        </section>

        {/* What it checks */}
        <section
          className={styles.section}
          aria-labelledby="checks-heading"
        >
          <h2 id="checks-heading" className={styles.sectionHeading}>
            What MCP Release checks
          </h2>
          <ul className={styles.checksList}>
            <li className={styles.checksItem}>
              <span className={styles.checksTitle}>Protocol</span>
              <span className={styles.checksDesc}>
                MCP initialization handshake, protocol version
                negotiation, and transport behavior
              </span>
            </li>
            <li className={styles.checksItem}>
              <span className={styles.checksTitle}>Tool schemas</span>
              <span className={styles.checksDesc}>
                Tool names, descriptions, input schemas, output
                schemas, and duplicate detection
              </span>
            </li>
            <li className={styles.checksItem}>
              <span className={styles.checksTitle}>Network safety</span>
              <span className={styles.checksDesc}>
                SSRF protection, DNS pinning, redirect validation, and
                private address blocking (HTTP/SSE)
              </span>
            </li>
            <li className={styles.checksItem}>
              <span className={styles.checksTitle}>Stdio transport</span>
              <span className={styles.checksDesc}>
                Unexpected stdout output, malformed MCP messages,
                response size limits, and clean shutdown
              </span>
            </li>
            <li className={styles.checksItem}>
              <span className={styles.checksTitle}>Reports</span>
              <span className={styles.checksDesc}>
                Findings exportable as JSON or Markdown
              </span>
            </li>
          </ul>
        </section>

        {/* Result meanings */}
        <section
          className={styles.section}
          aria-labelledby="results-heading"
        >
          <h2 id="results-heading" className={styles.sectionHeading}>
            Understanding results
          </h2>
          <ul className={styles.resultsList}>
            <li className={styles.resultItem}>
              <span
                className={`${styles.resultBadge} ${styles.badgePass}`}
              >
                PASS
              </span>
              <div className={styles.resultContent}>
                <span className={styles.resultTitle}>
                  All checks passed
                </span>
                <span className={styles.resultDesc}>
                  The endpoint responded correctly and all validated
                  properties met requirements. A PASS reflects the
                  checks MCP Release ran. It is not a guarantee of
                  correctness.
                </span>
              </div>
            </li>
            <li className={styles.resultItem}>
              <span
                className={`${styles.resultBadge} ${styles.badgeWarn}`}
              >
                WARNING
              </span>
              <div className={styles.resultContent}>
                <span className={styles.resultTitle}>
                  Some checks did not complete
                </span>
                <span className={styles.resultDesc}>
                  One or more checks could not complete or found a
                  non-blocking issue. If your server requires
                  authorization, MCP Release returns{" "}
                  <code className={styles.inlineCode}>AUTH_REQUIRED</code>{" "}
                  as a warning. In the browser checker, authenticated
                  checks are not performed. The browser checker does not
                  accept or store credentials. Use the CLI or GitHub
                  Action for authenticated scenarios.
                </span>
              </div>
            </li>
            <li className={styles.resultItem}>
              <span
                className={`${styles.resultBadge} ${styles.badgeFail}`}
              >
                FAIL
              </span>
              <div className={styles.resultContent}>
                <span className={styles.resultTitle}>
                  One or more blocking findings
                </span>
                <span className={styles.resultDesc}>
                  At least one check found a blocking condition. Examples:
                  an invalid tool name, a missing required schema field,
                  or a transport error.
                </span>
              </div>
            </li>
          </ul>
        </section>

        {/* Security model */}
        <section
          className={styles.section}
          aria-labelledby="security-heading"
        >
          <h2 id="security-heading" className={styles.sectionHeading}>
            Security model
          </h2>
          <ul className={styles.securityList}>
            <li>
              Tools are discovered via{" "}
              <code className={styles.inlineCode}>tools/list</code> but
              never invoked. No arguments are constructed or sent.
            </li>
            <li>
              Only public HTTPS endpoints are accepted by the web checker.
              HTTP is rejected before any connection.
            </li>
            <li>
              Private, loopback, link-local, and cloud-metadata
              destinations are blocked at the DNS level
            </li>
            <li>
              Redirects and resolved IP addresses are re-validated at
              each hop
            </li>
            <li>
              Remote response bodies and credentials are never included
              in findings
            </li>
            <li>
              The web checker does not accept, forward, or store
              endpoint credentials
            </li>
          </ul>
        </section>

        {/* CLI */}
        <section
          className={styles.section}
          aria-labelledby="cli-heading"
        >
          <h2 id="cli-heading" className={styles.sectionHeading}>
            Use from the terminal
          </h2>
          <p className={styles.demoDesc}>
            For private, staging, localhost, or authenticated endpoints,
            use the CLI. Credentials stay on your machine.
          </p>
          <pre className={styles.pre}>
            <code className={styles.preCode}>{`npm install -g @mcp-release/cli

# HTTP/SSE endpoint
mcp-release check https://your-mcp-server.example.com/mcp

# Or without installing
npx -y @mcp-release/cli check https://your-mcp-server.example.com/mcp`}</code>
          </pre>
          <p className={styles.preLabel}>Local stdio server:</p>
          <pre className={styles.pre}>
            <code className={styles.preCode}>{`npx -y @mcp-release/cli check --stdio --command "npx -y my-mcp-server"`}</code>
          </pre>
        </section>

        {/* Demo */}
        <section
          className={styles.section}
          aria-labelledby="demo-heading"
        >
          <h2 id="demo-heading" className={styles.sectionHeading}>
            Try the demo endpoint
          </h2>
          <p className={styles.demoDesc}>
            A public fixture server is available for testing. It returns
            fixed results with no external dependencies.
          </p>
          <code className={styles.demoUrl}>{DEMO_ENDPOINT}</code>
          <p className={styles.demoNote}>
            Use the{" "}
            <strong className={styles.demoStrong}>
              Try demo endpoint
            </strong>{" "}
            button in the form above, or paste this URL and click{" "}
            <strong className={styles.demoStrong}>
              Run Release Check
            </strong>
            .
          </p>
        </section>
      </main>
      <Footer />
    </>
  );
}
