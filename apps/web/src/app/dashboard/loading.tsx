import styles from "@/features/dashboard/dashboard.module.css";

export default function DashboardLoading() {
  return (
    <section className={styles.page} aria-label="Loading dashboard">
      <div className={styles.emptyState}>
        <div>
          <strong>LOADING WORKSPACE</strong>
          <span>Checking your session and dashboard data…</span>
        </div>
      </div>
    </section>
  );
}
