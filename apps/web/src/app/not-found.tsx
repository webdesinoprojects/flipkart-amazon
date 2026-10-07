import Link from "next/link";
import styles from "@/features/marketing/marketing.module.css";
import status from "@/features/marketing/status.module.css";

export default function NotFound() {
  return (
    <main className={status.statusPage}>
      <span className={styles.kicker}>404 / PAGE NOT FOUND</span>
      <h1>NOTHING AT THIS ADDRESS.</h1>
      <p>
        The page may have moved. You can return home or open the label
        workspace.
      </p>
      <div className={styles.heroActions}>
        <Link className={styles.buttonLight} href="/">
          BACK TO HOME ↗
        </Link>
        <Link className={styles.buttonOutline} href="/app">
          OPEN THE APP
        </Link>
      </div>
    </main>
  );
}
