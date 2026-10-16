import { describeOutputVolume } from "@label-normalizer/core";
import { ArrowUpRight, Boxes, FileClock, ScanLine } from "lucide-react";
import Link from "next/link";
import type { AuthUser } from "@/features/auth/contracts";
import type { DashboardSummary, SavedBatch } from "./contracts";
import { DashboardPage } from "./page-shell";
import styles from "./dashboard.module.css";
import { UsageChart } from "./usage-chart";

export function DashboardOverview({
  user,
  summary,
}: {
  readonly user: AuthUser;
  readonly summary: DashboardSummary | null;
}) {
  return (
    <DashboardPage
      eyebrow="OVERVIEW / PERSONAL WORKSPACE"
      title={`Welcome back, ${displayName(user.email)}.`}
      description="Prepare mixed marketplace PDFs, monitor real usage, and retrieve generated batches automatically saved to your private history."
      action={
        <Link className={styles.primaryAction} href="/dashboard/labels">
          OPEN LABEL WORKSPACE
          <ArrowUpRight aria-hidden="true" size={15} />
        </Link>
      }
    >
      {!summary && (
        <div className={styles.dataNotice} role="status">
          Usage data is temporarily unavailable. Local label processing still
          works; refresh after the API reconnects.
        </div>
      )}
      <div className={styles.overviewGrid}>
        <article className={`${styles.card} ${styles.startCard}`}>
          <div className={styles.startMark}>
            <ScanLine aria-hidden="true" size={34} strokeWidth={1.4} />
          </div>
          <div>
            <h2>Start a new label batch</h2>
            <p>
              Process Amazon, Flipkart, and Meesho PDFs locally. The generated
              combined PDF is retained automatically; source PDFs stay local.
            </p>
            <Link className={styles.primaryAction} href="/dashboard/labels">
              SELECT PDFS
              <ArrowUpRight aria-hidden="true" size={14} />
            </Link>
          </div>
        </article>

        <article className={`${styles.card} ${styles.statusCard}`}>
          <div>
            <h2>Account status</h2>
            <p>Your self-hosted account and session are active.</p>
          </div>
          <strong className={styles.statusValue}>
            {user.emailVerified ? "Verified" : "Active"}
          </strong>
          <span className={styles.statusDetail}>
            <i aria-hidden="true" /> AUTHENTICATED SESSION
          </span>
        </article>

        <MetricCard
          title="Labels saved today"
          value={formatNumber(summary?.usageToday)}
          note={`${formatNumber(summary?.batchesToday)} saved batches today`}
        />
        <MetricCard
          title="Total generated labels"
          value={formatNumber(summary?.totalLabels)}
          note={`${formatNumber(summary?.totalBatches)} durable batches`}
        />
        <MetricCard
          title="Available credits"
          value={
            summary?.availableCredits?.toLocaleString("en-IN") ?? "Not active"
          }
          note={
            summary?.activePlan
              ? `${summary.activePlan} · plan credits refresh daily; bonus credits expire`
              : "Credit status is temporarily unavailable."
          }
        />

        <article className={`${styles.card} ${styles.chartCard}`}>
          <div className={styles.cardHeader}>
            <div>
              <h2>Label output / last 14 days</h2>
              <p>Saved output labels and batches, grouped in Asia/Kolkata.</p>
            </div>
            <span className={styles.chartLegend}>
              <i /> LABELS <b /> BATCHES
            </span>
          </div>
          {summary ? (
            <UsageChart data={summary.dailyUsage} />
          ) : (
            <div className={styles.chartUnavailable}>DATA UNAVAILABLE</div>
          )}
        </article>

        <article className={`${styles.card} ${styles.sideCard}`}>
          <div className={styles.cardHeader}>
            <div>
              <h2>Marketplace adapters</h2>
              <p>Deterministic local processing.</p>
            </div>
            <Boxes aria-hidden="true" size={20} strokeWidth={1.5} />
          </div>
          <div className={styles.marketplaceList}>
            {[
              ["Flipkart", "E-Kart extraction"],
              ["Amazon", "Page classification"],
              ["Meesho", "Content trimming"],
            ].map(([name, detail]) => (
              <div className={styles.marketplaceItem} key={name}>
                <div>
                  <strong>{name}</strong>
                  <p>{detail}</p>
                </div>
                <span className={styles.supportBadge}>SUPPORTED</span>
              </div>
            ))}
          </div>
        </article>

        <RecentBatches batches={summary?.recentBatches ?? []} />
      </div>
    </DashboardPage>
  );
}

function RecentBatches({ batches }: { readonly batches: SavedBatch[] }) {
  return (
    <article className={`${styles.card} ${styles.fullCard}`}>
      <div className={styles.cardHeader}>
        <div>
          <h2>Recent saved batches</h2>
          <p>Only automatically retained generated outputs appear here.</p>
        </div>
        <Link href="/dashboard/history">VIEW ALL</Link>
      </div>
      {batches.length === 0 ? (
        <div className={styles.emptyState}>
          <div>
            <FileClock aria-hidden="true" size={27} strokeWidth={1.5} />
            <strong>NO SAVED BATCHES YET</strong>
            <span>Finish a batch and its generated PDF will appear here.</span>
          </div>
        </div>
      ) : (
        <div className={styles.batchRows}>
          {batches.map((batch) => (
            <div className={styles.batchRow} key={batch.id}>
              <div>
                <strong>{formatDateTime(batch.createdAt)}</strong>
                <span>{marketplaceLabel(batch.marketplaceCounts)}</span>
              </div>
              <span>{batch.sourceDocumentCount} PDFS</span>
              <span>
                {describeOutputVolume(batch.labelsReady, batch.outputLayout)}
              </span>
              <a href={batch.downloadUrl}>DOWNLOAD</a>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function MetricCard({
  title,
  value,
  note,
}: {
  title: string;
  value: string;
  note: string;
}) {
  return (
    <article className={`${styles.card} ${styles.metricCard}`}>
      <h3>{title}</h3>
      <strong className={styles.metricValue}>{value}</strong>
      <span className={styles.metricNote}>{note}</span>
    </article>
  );
}

function formatNumber(value: number | undefined): string {
  return value === undefined ? "—" : value.toLocaleString("en-IN");
}

function marketplaceLabel(counts: Record<string, number>): string {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([marketplace, count]) => `${marketplace.toUpperCase()} ${count}`)
    .join(" / ");
}

function displayName(email: string): string {
  const readable = (email.split("@")[0] ?? "seller")
    .replace(/[._-]+/g, " ")
    .trim();
  return readable
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}
