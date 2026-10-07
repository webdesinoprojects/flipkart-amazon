import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/features/marketing/logo";
import styles from "./auth.module.css";

export function AuthShell({
  eyebrow,
  title,
  description,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Logo href="/" wordmark />
        <Link href="/" className={styles.backLink}>
          ← PRODUCT SITE
        </Link>
      </header>
      <section className={styles.frame}>
        <aside className={styles.context}>
          <span className={styles.eyebrow}>{eyebrow}</span>
          <p>ACCOUNT CONTROL / SELF-HOSTED SESSIONS / NO THIRD-PARTY AUTH</p>
          <div className={styles.rules} aria-label="Account security notes">
            <span>HTTPONLY SESSION</span>
            <span>ARGON2ID PASSWORDS</span>
            <span>SESSION-BOUND CSRF</span>
          </div>
        </aside>
        <div className={styles.card}>
          <span className={styles.eyebrow}>{eyebrow}</span>
          <h1>{title}</h1>
          <p className={styles.description}>{description}</p>
          {children}
          {footer && <div className={styles.footer}>{footer}</div>}
        </div>
      </section>
    </main>
  );
}
