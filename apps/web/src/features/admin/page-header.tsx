import type { ReactNode } from "react";
import styles from "./admin.module.css";

export function AdminPageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className={styles.pageHeader}>
      <div>
        <span className={styles.eyebrow}>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
}

export function AdminUnavailable() {
  return (
    <div className={styles.unavailable} role="status">
      <strong>Admin data is temporarily unavailable.</strong>
      <span>
        Check the API and refresh. No values are estimated or cached here.
      </span>
    </div>
  );
}
