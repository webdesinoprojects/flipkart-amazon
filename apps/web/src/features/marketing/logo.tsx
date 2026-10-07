import Link from "next/link";
import styles from "./marketing.module.css";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link
      className={styles.logo}
      href={href}
      aria-label="Label Normalizer home"
    >
      <span className={styles.logoMark} aria-hidden="true">
        <span className={styles.logoLines} />
      </span>
      <span>
        LABEL<span className={styles.logoLight}>/</span>NORMALIZER
      </span>
    </Link>
  );
}
