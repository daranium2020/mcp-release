import styles from "./Header.module.css";
import { SITE_NAME, SITE_DESCRIPTION, GITHUB_URL } from "../lib/constants";

export default function Header() {
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <a href="/" className={styles.wordmark}>
            {SITE_NAME}
          </a>
          <span className={styles.descriptor}>{SITE_DESCRIPTION}</span>
        </div>
        <nav className={styles.nav} aria-label="Site navigation">
          <a href="/docs" className={styles.navLink}>
            Docs
          </a>
          <a
            href={GITHUB_URL}
            className={styles.ghLink}
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}
