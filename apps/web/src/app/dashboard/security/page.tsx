import { SecuritySessions } from "@/features/auth/security-sessions";
import styles from "@/features/dashboard/dashboard.module.css";
export const metadata = { title: "Account security" };
export default function SecurityPage() {
  return (
    <section className={styles.panel}>
      <header className={styles.panelHead}>
        <div>
          <span className={styles.eyebrow}>ACCOUNT / SECURITY</span>
          <h1>Security & sessions</h1>
        </div>
      </header>
      <SecuritySessions />
    </section>
  );
}
