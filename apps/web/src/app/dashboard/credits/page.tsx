import { Activity, BadgeIndianRupee, ReceiptText } from "lucide-react";
import type { ReactNode } from "react";
import { DashboardPage } from "@/features/dashboard/page-shell";
import { dashboardSummary } from "@/features/dashboard/server-api";
import { UsageChart } from "@/features/dashboard/usage-chart";
import styles from "@/features/dashboard/dashboard.module.css";

export const metadata = { title: "Credits and usage" };

export default async function CreditsPage() {
  const summary = await dashboardSummary();
  return (
    <DashboardPage
      eyebrow="ACCOUNT / USAGE"
      title="Usage without guesswork."
      description="One successfully prepared label uses one credit. Plan credits refresh daily in Asia/Kolkata; one-time support credits expire on their grant date."
    >
      <div className={styles.routeGrid}>
        <StatusCard
          icon={<BadgeIndianRupee aria-hidden="true" size={21} />}
          title="Available credits"
          value={
            summary?.availableCredits?.toLocaleString("en-IN") ?? "Not active"
          }
          copy="Daily plan credits plus any unexpired one-time credits."
        />
        <StatusCard
          icon={<Activity aria-hidden="true" size={21} />}
          title="Labels saved today"
          value={summary?.usageToday.toLocaleString("en-IN") ?? "—"}
          copy={`${summary?.batchesToday ?? 0} durable batches saved today.`}
        />
        <StatusCard
          icon={<ReceiptText aria-hidden="true" size={21} />}
          title="All-time saved output"
          value={summary?.totalLabels.toLocaleString("en-IN") ?? "—"}
          copy={`${summary?.totalBatches ?? 0} generated PDF batches retained.`}
        />
        <article className={`${styles.card} ${styles.routeChart}`}>
          <div className={styles.cardHeader}>
            <div>
              <h2>14-day output</h2>
              <p>Labels and saved batches in Asia/Kolkata.</p>
            </div>
          </div>
          {summary ? (
            <UsageChart data={summary.dailyUsage} />
          ) : (
            <div className={styles.chartUnavailable}>DATA UNAVAILABLE</div>
          )}
        </article>
      </div>
    </DashboardPage>
  );
}

function StatusCard({
  icon,
  title,
  value,
  copy,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly value: string;
  readonly copy: string;
}) {
  return (
    <article className={styles.card}>
      {icon}
      <h2>{title}</h2>
      <strong className={styles.metricValue}>{value}</strong>
      <p>{copy}</p>
    </article>
  );
}
