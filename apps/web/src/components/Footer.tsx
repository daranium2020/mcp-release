import styles from "./Footer.module.css";
import { SITE_NAME } from "../lib/constants";

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <span className={styles.name}>{SITE_NAME}</span>
        <span className={styles.sep}>·</span>
        <span className={styles.note}>Never invokes MCP tools</span>
        <span className={styles.sep}>·</span>
        <span className={styles.note}>Built for safe release validation</span>
      </div>
    </footer>
  );
}
