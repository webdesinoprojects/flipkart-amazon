"use client";

import Link from "next/link";
import styles from "@/features/marketing/marketing.module.css";
import status from "@/features/marketing/status.module.css";

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const safeDigest =
    error.digest && /^[A-Za-z0-9_-]{1,64}$/.test(error.digest)
      ? error.digest
      : null;
  return (
    <main className={status.statusPage} role="alert">
      <span className={styles.kicker}>SOMETHING WENT WRONG</span>
      <h1>THIS PAGE COULD NOT LOAD.</h1>
      <p>
        Please try again. If the problem continues, return to the start page.
      </p>
      {safeDigest && (
        <p className={status.statusDigest}>REFERENCE: {safeDigest}</p>
      )}
      <div className={styles.heroActions}>
        <button className={styles.buttonLight} onClick={retry}>
          TRY AGAIN ↗
        </button>
        <Link className={styles.buttonOutline} href="/">
          BACK TO HOME
        </Link>
      </div>
    </main>
  );
}
