import styles from "./Footer.module.css";
import { SITE_NAME, GITHUB_URL } from "../lib/constants";

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
          href={GITHUB_URL}
          className={styles.link}
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </a>
        <span className={styles.sep} aria-hidden="true">·</span>
        <span className={styles.note}>Built for safer MCP releases</span>
      </div>
    </footer>
  );
}
