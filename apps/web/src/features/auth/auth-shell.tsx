"use client";

import * as Switch from "@radix-ui/react-switch";
import { ArrowLeft, Moon, Sun } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState, type ReactNode } from "react";
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
  const [dark, setDark] = useState(false);

  return (
    <main className={styles.page} data-theme={dark ? "dark" : "light"}>
      <section className={styles.frame}>
        <aside className={styles.visualPanel}>
          <div className={styles.visualBrand}>
            <Logo href="/" wordmark />
            <span>SELLER WORKSPACE</span>
          </div>

          <div className={styles.illustration} aria-hidden="true">
            <Image
              alt=""
              fill
              priority
              sizes="(max-width: 900px) 1px, 46vw"
              src="/images/auth/label-workspace-illustration.png"
            />
          </div>

          <div className={styles.visualCopy}>
            <span className={styles.eyebrow}>LOCAL-FIRST LABEL OPERATIONS</span>
            <h2>From marketplace PDFs to one clean print batch.</h2>
            <p>
              Classify, review, normalize, and print without sending original
              customer documents to an account provider.
            </p>
          </div>

          <div className={styles.trustStrip} aria-label="Product safeguards">
            <span>LOCAL PDF PIPELINE</span>
            <span>PRIVATE OUTPUT HISTORY</span>
            <span>OWNER-SCOPED ACCESS</span>
          </div>
        </aside>

        <section className={styles.formPanel}>
          <header className={styles.header}>
            <Link href="/" className={styles.backLink}>
              <ArrowLeft aria-hidden="true" size={15} strokeWidth={1.8} />
              PRODUCT SITE
            </Link>
            <div className={styles.themeControl}>
              <Sun aria-hidden="true" size={15} strokeWidth={1.8} />
              <Switch.Root
                checked={dark}
                className={styles.themeSwitch}
                onCheckedChange={setDark}
                aria-label="Use dark theme"
              >
                <Switch.Thumb className={styles.themeThumb} />
              </Switch.Root>
              <Moon aria-hidden="true" size={14} strokeWidth={1.8} />
            </div>
          </header>

          <div className={styles.card}>
            <span className={styles.eyebrow}>{eyebrow}</span>
            <h1>{title}</h1>
            <p className={styles.description}>{description}</p>
            {children}
            {footer ? <div className={styles.footer}>{footer}</div> : null}
          </div>

          <p className={styles.panelFoot}>
            HTTPONLY SESSION / ARGON2ID / SESSION-BOUND CSRF
          </p>
        </section>
      </section>
    </main>
  );
}
