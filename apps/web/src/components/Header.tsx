import Image from "next/image";
import styles from "./Header.module.css";
import { GITHUB_URL } from "../lib/constants";

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
