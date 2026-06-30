import Image from "next/image";
import styles from "./Header.module.css";

export default function Header() {
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <a href="/" className={styles.logoLink}>
            <Image
              src="/brand/mcp-release-logo-light-text.png"
              alt="MCP Release"
              width={571}
              height={227}
              className={styles.logo}
              priority
            />
          </a>
        </div>
        <nav className={styles.nav} aria-label="Site navigation">
          <a href="/docs" className={styles.navLink}>
            Docs
          </a>
          <a
            href="mailto:feedback@mcprelease.dev"
            className={styles.ghLink}
          >
            Feedback
          </a>
        </nav>
      </div>
    </header>
  );
}
