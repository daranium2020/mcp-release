import styles from "./Footer.module.css";
import { SITE_NAME } from "../lib/constants";

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <span className={styles.name}>{SITE_NAME}</span>
        <span className={styles.sep} aria-hidden="true">·</span>
        <a href="/docs" className={styles.link}>
          Documentation
        </a>
        <span className={styles.sep} aria-hidden="true">·</span>
        <a
          href="mailto:feedback@mcprelease.dev"
          className={styles.link}
        >
          Feedback
        </a>
        <span className={styles.sep} aria-hidden="true">·</span>
        <span className={styles.note}>MCP server validation</span>
      </div>
    </footer>
  );
}
