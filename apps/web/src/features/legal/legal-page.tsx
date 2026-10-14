import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/features/marketing/logo";
import styles from "./legal-page.module.css";

export function LegalPage({
  eyebrow,
  title,
  summary,
  children,
}: {
  eyebrow: string;
  title: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" aria-label="SellerLabel home">
          <Logo wordmark />
        </Link>
        <Link href="/register">START FREE ↗</Link>
      </header>
      <article className={styles.document}>
        <div className={styles.intro}>
          <span>{eyebrow}</span>
          <h1>{title}</h1>
          <p>{summary}</p>
          <small>Effective 14 October 2026</small>
        </div>
        <div className={styles.content}>{children}</div>
      </article>
      <footer className={styles.footer}>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/refund-policy">Refund policy</Link>
        <Link href="/contact">Contact</Link>
        <a href="mailto:sellerlabels@gmail.com">sellerlabels@gmail.com</a>
      </footer>
    </main>
  );
}
