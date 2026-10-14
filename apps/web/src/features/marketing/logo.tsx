import Link from "next/link";
import styles from "./navigation.module.css";

function LogoMark() {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M7 22V7h15M42 7h15v15M57 42v15H42M22 57H7V42"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="square"
      />
      <path d="M19 18h26v28H19z" stroke="currentColor" strokeWidth="2.5" />
      <path
        d="M24 24h16M24 29h11M24 35v7m4-7v7m3-7v7m4-7v7m3-7v7m3-7v7"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export function Logo({
  href = "/",
  wordmark = false,
}: {
  href?: string;
  wordmark?: boolean;
}) {
  return (
    <Link
      className={wordmark ? styles.logoWithWordmark : styles.logo}
      href={href}
      aria-label="SellerLabel home"
    >
      {wordmark ? (
        <span className={styles.logo}>
          <LogoMark />
        </span>
      ) : (
        <LogoMark />
      )}
      {wordmark && <span>SELLERLABEL</span>}
    </Link>
  );
}
