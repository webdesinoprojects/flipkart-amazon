import { AlertCircle, CheckCircle2, Clock3 } from "lucide-react";
import {
  AdminPageHeader,
  AdminUnavailable,
} from "@/features/admin/page-header";
import { adminOperations } from "@/features/admin/server-api";
import { dateTime, number } from "@/features/admin/format";
import styles from "@/features/admin/admin.module.css";

export default async function AdminOperationsPage() {
  const data = await adminOperations();
  const unresolved = data
    ? (data.webhookCounts.pending ?? 0) +
      (data.webhookCounts.retry ?? 0) +
      (data.webhookCounts.processing ?? 0)
    : 0;
  const rejected = data?.webhookCounts.rejected ?? 0;
  return (
    <>
      <AdminPageHeader
        eyebrow="OPERATIONS / BILLING INBOX"
        title="Know what needs attention."
        description="Signed webhook events are stored before background verification. This page makes stalled or rejected events visible without exposing keys."
      />
      {!data ? (
        <AdminUnavailable />
      ) : (
        <>
          <div className={styles.metrics}>
            <article
              className={`${styles.glassDark} ${styles.pad} ${styles.metric}`}
            >
              <div className={styles.metricTop}>
                <span className={styles.metricLabel}>Unresolved events</span>
                <span className={styles.metricIcon}>
                  <Clock3 aria-hidden="true" size={20} />
                </span>
              </div>
              <strong className={styles.metricValue}>
                {number(unresolved)}
              </strong>
              <span className={styles.metricDetail}>
                Pending, retrying or processing
              </span>
            </article>
            <article
              className={`${styles.glass} ${styles.pad} ${styles.metric}`}
            >
              <div className={styles.metricTop}>
                <span className={styles.metricLabel}>Oldest unresolved</span>
                <span className={styles.metricIcon}>
                  <Clock3 aria-hidden="true" size={20} />
                </span>
              </div>
              <strong className={styles.metricValue}>
                {data.oldestUnresolvedSeconds == null
                  ? "Clear"
                  : `${Math.ceil(data.oldestUnresolvedSeconds / 60)}m`}
              </strong>
              <span className={styles.metricDetail}>
                Investigate if older than 5 minutes
              </span>
            </article>
            <article
              className={`${styles.glassGreen} ${styles.pad} ${styles.metric}`}
            >
              <div className={styles.metricTop}>
                <span className={styles.metricLabel}>Processed</span>
                <span className={styles.metricIcon}>
                  <CheckCircle2 aria-hidden="true" size={20} />
                </span>
              </div>
              <strong className={styles.metricValue}>
                {number(
                  (data.webhookCounts.done ?? 0) +
                    (data.webhookCounts.ignored ?? 0),
                )}
              </strong>
              <span className={styles.metricDetail}>
                Done or deliberately ignored
              </span>
            </article>
            <article
              className={`${styles.glass} ${styles.pad} ${styles.metric}`}
            >
              <div className={styles.metricTop}>
                <span className={styles.metricLabel}>Rejected</span>
                <span className={styles.metricIcon}>
                  <AlertCircle aria-hidden="true" size={20} />
                </span>
              </div>
              <strong className={styles.metricValue}>{number(rejected)}</strong>
              <span className={styles.metricDetail}>
                Manual review may be needed
              </span>
            </article>
          </div>
          <section
            className={`${styles.glass} ${styles.pad} ${styles.sectionCard}`}
          >
            <div className={styles.sectionTitle}>
              <div>
                <h2>Events to review</h2>
                <p>Latest 25 pending, retrying or rejected events</p>
              </div>
              <span className={styles.eyebrowTag}>SIGNED INBOX</span>
            </div>
            {data.events.length === 0 ? (
              <div className={styles.empty}>
                No unresolved or rejected events.
              </div>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Type</th>
                      <th>Received</th>
                      <th>Attempts</th>
                      <th>State</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.events.map((event) => (
                      <tr key={event.id}>
                        <td>
                          <code>{event.id.slice(0, 14)}…</code>
                        </td>
                        <td>{event.type}</td>
                        <td className={styles.nowrap}>
                          {dateTime(event.receivedAt)}
                        </td>
                        <td>{event.attempts}</td>
                        <td>
                          <span
                            className={`${styles.pill} ${event.status === "rejected" ? styles.pillDanger : styles.pillWarning}`}
                          >
                            {event.status}
                          </span>
                        </td>
                        <td>
                          <code>{event.lastError ?? "—"}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <p className={styles.note}>
            Updated {dateTime(data.asOf)}. A clear inbox does not prove worker
            uptime; monitor /health/ready and the worker separately.
          </p>
        </>
      )}
    </>
  );
}
