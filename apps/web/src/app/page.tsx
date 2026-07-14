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
            Verify the protocol handshake, tool schemas, and network
            behavior. MCP Release does not execute tools.
          </p>
          <a href="/docs" className={styles.docsLink}>
            View documentation
          </a>
        </section>

        {/* Check form */}
        <CheckClient demoEndpoint={DEMO_ENDPOINT} />

        {/* How it works */}
        <section
          className={styles.section}
          aria-labelledby="how-heading"
        >
          <h2 id="how-heading" className={styles.sectionHeading}>
            How it works
          </h2>
          <ol className={styles.stepsList}>
            <li className={styles.step}>
              <span className={styles.stepNum} aria-hidden="true">
                1
              </span>
              <div className={styles.stepContent}>
                <span className={styles.stepTitle}>
                  Enter a public HTTPS endpoint
                </span>
                <span className={styles.stepDesc}>
                  Paste your MCP server URL. Only HTTPS endpoints are
                  accepted. No credentials are needed or stored.
                </span>
              </div>
            </li>
            <li className={styles.step}>
              <span className={styles.stepNum} aria-hidden="true">
                2
              </span>
              <div className={styles.stepContent}>
                <span className={styles.stepTitle}>
                  Validation runs
                </span>
                <span className={styles.stepDesc}>
                  MCP Release connects, negotiates the protocol, and
                  lists tools. Tools are never invoked.
                </span>
              </div>
            </li>
            <li className={styles.step}>
              <span className={styles.stepNum} aria-hidden="true">
                3
              </span>
              <div className={styles.stepContent}>
                <span className={styles.stepTitle}>
                  Review or export the findings
                </span>
                <span className={styles.stepDesc}>
                  Read the report in the browser, or download it as
                  JSON or Markdown.
                </span>
              </div>
            </li>
          </ol>
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
                private address blocking
              </span>
            </li>
            <li className={styles.checksItem}>
              <span className={styles.checksTitle}>
                Reports
              </span>
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
                  as a warning. Authenticated checks are not performed.
                  No credentials are accepted or stored.
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
              Only public HTTPS endpoints are accepted. HTTP is
              rejected before any connection.
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
              No endpoint credentials are accepted, forwarded, or
              stored
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
mcp-release check https://your-mcp-server.example.com/mcp

# Or without installing
npx -y @mcp-release/cli check https://your-mcp-server.example.com/mcp`}</code>
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
