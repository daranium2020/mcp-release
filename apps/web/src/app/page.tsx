import Header from "../components/Header";
import Footer from "../components/Footer";
import CheckClient from "../components/CheckClient";
import styles from "./page.module.css";

export default function HomePage() {
  return (
    <>
      <Header />
      <main className={styles.main}>
        <section className={styles.hero} aria-labelledby="headline">
          <h1 id="headline" className={styles.headline}>
            Ship MCP servers with confidence.
          </h1>
          <p className={styles.subhead}>
            Validate protocol behavior, tool schemas, network security, and
            release readiness before production.
          </p>
        </section>
        <CheckClient />
        <section className={styles.checks} aria-labelledby="checks-heading">
          <h2 id="checks-heading" className={styles.checksHeading}>
            What MCP Release checks
          </h2>
          <ul className={styles.checksList}>
            <li className={styles.checksItem}>
              <span className={styles.checksTitle}>Protocol</span>
              <span className={styles.checksDesc}>
                initialization and transport behavior
              </span>
            </li>
            <li className={styles.checksItem}>
              <span className={styles.checksTitle}>Tool schemas</span>
              <span className={styles.checksDesc}>
                names, descriptions, input and output schemas
              </span>
            </li>
            <li className={styles.checksItem}>
              <span className={styles.checksTitle}>Network security</span>
              <span className={styles.checksDesc}>
                redirects, DNS safety and protected destinations
              </span>
            </li>
            <li className={styles.checksItem}>
              <span className={styles.checksTitle}>Release readiness</span>
              <span className={styles.checksDesc}>
                deterministic findings and exportable reports
              </span>
            </li>
          </ul>
        </section>
      </main>
      <Footer />
    </>
  );
}
