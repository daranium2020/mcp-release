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
            <h3 className={styles.h3}>Network safety</h3>
            <ul className={styles.ul}>
              <li>SSRF protection (RFC 1918, loopback, link-local blocked)</li>
              <li>DNS pinning (pre-resolve, validate IP, pin TCP connection)</li>
              <li>Redirect chain validation (up to 3 hops)</li>
              <li>HTTPS enforcement across all redirects</li>
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

          {/* AUTH_REQUIRED */}
          <section aria-labelledby="auth-heading">
            <h2 id="auth-heading" className={styles.h2}>
              AUTH_REQUIRED behavior
            </h2>
            <p>
              If the server returns <code className={styles.code}>401</code>{" "}
              during the MCP initialization handshake, MCP Release records an{" "}
              <code className={styles.code}>AUTH_REQUIRED</code> finding with
              severity <strong>WARNING</strong> and stops validation.
            </p>
            <p>
              This is expected for servers that require authentication. It is
              not a failure of the server. It is a limitation of MCP Release:
              no credentials are accepted or stored, so authenticated checks
              cannot be performed.
            </p>
            <p>
              The overall result will be <strong>WARNING</strong>, not PASS.
              Subsequent checks (tool schema validation, etc.) are not
              performed.
            </p>
          </section>

          {/* Security model */}
          <section aria-labelledby="security-heading">
            <h2 id="security-heading" className={styles.h2}>
              Security model
            </h2>
            <ul className={styles.ul}>
              <li>
                Tools are discovered via{" "}
                <code className={styles.code}>tools/list</code> but never
                invoked. No arguments are constructed or sent.
              </li>
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
                Remote response bodies are never included in findings.
              </li>
              <li>
                No endpoint credentials are accepted, forwarded, or stored.
              </li>
              <li>
                TLS verification is enforced (
                <code className={styles.code}>rejectUnauthorized: true</code>).
              </li>
              <li>
                Error messages are redacted before being returned. Token
                patterns and embedded URL credentials are stripped.
              </li>
            </ul>
          </section>

          {/* Report exports */}
          <section aria-labelledby="exports-heading">
            <h2 id="exports-heading" className={styles.h2}>
              Report exports
            </h2>
            <p>
              After a check completes, the findings report can be exported in
              two formats:
            </p>
            <ul className={styles.ul}>
              <li>
                <strong>JSON</strong>: machine-readable, for CI pipelines and
                automated tooling
              </li>
              <li>
                <strong>Markdown</strong>: human-readable, for pull request
                summaries and release notes
              </li>
            </ul>
            <p>
              The JSON schema version is{" "}
              <code className={styles.code}>&quot;1&quot;</code>. All fields
              are documented in the repository.
            </p>
          </section>

          {/* Known limitations */}
          <section aria-labelledby="limitations-heading">
            <h2 id="limitations-heading" className={styles.h2}>
              Known limitations
            </h2>
            <ul className={styles.ul}>
              <li>
                <strong>Public HTTPS endpoints only.</strong> HTTP and private
                network endpoints are rejected.
              </li>
              <li>
                <strong>No credential input.</strong> Authenticated checks are
                not performed.
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
                <strong>In-memory rate limiting.</strong> Per-process only,
                not shared across scaled instances.
              </li>
              <li>
                <strong>No persistent storage.</strong> Reports are not saved
                server-side. Export before closing the tab.
              </li>
            </ul>
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
              <code>{`- uses: daranium2020/mcp-release@main
  with:
    endpoint: https://your-mcp-server.example.com/mcp
    fail-on: fail        # optional: fail (default) | warning
    timeout-ms: 10000    # optional: 1000-30000`}</code>
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
