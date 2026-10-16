import {
  Activity,
  ArrowUpRight,
  BadgeIndianRupee,
  Boxes,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import {
  AdminPageHeader,
  AdminUnavailable,
} from "@/features/admin/page-header";
import { adminOverview } from "@/features/admin/server-api";
import { dateTime, money, number } from "@/features/admin/format";
import styles from "@/features/admin/admin.module.css";

export default async function AdminPage() {
  const data = await adminOverview();
  const latest = data?.daily.slice(-7) ?? [];
  const maxLabels = Math.max(1, ...latest.map((day) => day.labels));
  const maxCaptured = Math.max(1, ...latest.map((day) => day.capturedPaise));
  const paidPercent = data?.customers.total
    ? Math.round((data.customers.paid / data.customers.total) * 100)
    : 0;

  return (
    <>
      <AdminPageHeader
        eyebrow="SELLERLABEL / CONTROL ROOM"
        title="A clearer view of your business."
        description="Live account and billing records, with usage grouped in India time. Payment figures are verified captured charges, not bank settlements."
        action={
          <Link className={styles.buttonLink} href="/admin/customers">
            Explore customers <ArrowUpRight aria-hidden="true" size={15} />
          </Link>
        }
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
                <span className={styles.metricLabel}>
                  Net after full refunds
                </span>
                <span className={styles.metricIcon}>
                  <BadgeIndianRupee aria-hidden="true" size={20} />
                </span>
              </div>
              <strong className={styles.metricValue}>
                {money(data.money.netAfterFullRefundsPaise)}
              </strong>
              <span className={styles.metricDetail}>
                {money(data.money.grossCapturedPaise)} gross captured
              </span>
            </article>
            <article
              className={`${styles.glass} ${styles.pad} ${styles.metric}`}
            >
              <div className={styles.metricTop}>
                <span className={styles.metricLabel}>Customers</span>
                <span className={styles.metricIcon}>
                  <UsersRound aria-hidden="true" size={20} />
                </span>
              </div>
              <strong className={styles.metricValue}>
                {number(data.customers.total)}
              </strong>
              <span className={styles.metricDetail}>
                {number(data.signups7d)} joined in the last 7 days
              </span>
            </article>
            <article
              className={`${styles.glassGreen} ${styles.pad} ${styles.metric}`}
            >
              <div className={styles.metricTop}>
                <span className={styles.metricLabel}>Paid customers</span>
                <span className={styles.metricIcon}>
                  <BadgeIndianRupee aria-hidden="true" size={20} />
                </span>
              </div>
              <strong className={styles.metricValue}>
                {number(data.customers.paid)}
              </strong>
              <span className={styles.metricDetail}>
                {number(data.customers.free)} on Early access
              </span>
            </article>
            <article
              className={`${styles.glass} ${styles.pad} ${styles.metric}`}
            >
              <div className={styles.metricTop}>
                <span className={styles.metricLabel}>Labels / 14 days</span>
                <span className={styles.metricIcon}>
                  <Boxes aria-hidden="true" size={20} />
                </span>
              </div>
              <strong className={styles.metricValue}>
                {number(data.labels14d)}
              </strong>
              <span className={styles.metricDetail}>
                From saved batches only
              </span>
            </article>
          </div>

          <div className={styles.dashboardGrid}>
            <section className={`${styles.glass} ${styles.pad}`}>
              <div className={styles.sectionTitle}>
                <div>
                  <h2>Label activity</h2>
                  <p>Saved output during the past seven India calendar days</p>
                </div>
                <span className={styles.eyebrowTag}>LAST 7 DAYS</span>
              </div>
              <div
                aria-label="Saved labels by day"
                className={styles.chart}
                role="img"
              >
                {latest.map((day) => (
                  <div className={styles.chartColumn} key={day.date}>
                    <div
                      className={styles.chartBar}
                      style={{
                        height: `${Math.max(3, (day.labels / maxLabels) * 100)}%`,
                      }}
                      title={`${day.date}: ${number(day.labels)} labels`}
                    />
                    <span>{day.date.slice(5)}</span>
                  </div>
                ))}
              </div>
              <div className={styles.chartSummary}>
                <span>
                  Today{" "}
                  <strong>{number(latest.at(-1)?.labels ?? 0)} labels</strong>
                </span>
                <span>
                  This week{" "}
                  <strong>
                    {number(latest.reduce((sum, day) => sum + day.labels, 0))}{" "}
                    labels
                  </strong>
                </span>
              </div>
            </section>
            <section className={`${styles.glass} ${styles.pad}`}>
              <div className={styles.sectionTitle}>
                <div>
                  <h2>Customer mix</h2>
                  <p>Currently paid versus Early access</p>
                </div>
                <span className={styles.eyebrowTag}>{paidPercent}% PAID</span>
              </div>
              <div className={styles.mixBar}>
                <span
                  className={styles.mixPaid}
                  style={{ width: `${paidPercent}%` }}
                />
                <span className={styles.mixFree} />
              </div>
              <div className={styles.mixLegend}>
                <span>
                  <small>PAID PLANS</small>
                  <strong>{number(data.customers.paid)}</strong>
                </span>
                <span>
                  <small>EARLY ACCESS</small>
                  <strong>{number(data.customers.free)}</strong>
                </span>
              </div>
              <p className={styles.insightNote}>
                {data.billingItemsNeedingReview === 0
                  ? "No pending or rejected billing events need review right now."
                  : `${number(data.billingItemsNeedingReview)} billing events are pending, retrying, or rejected.`}
              </p>
              <Link className={styles.textLink} href="/admin/operations">
                Check billing operations{" "}
                <ArrowUpRight aria-hidden="true" size={14} />
              </Link>
            </section>
          </div>

          <section
            className={`${styles.glass} ${styles.pad} ${styles.sectionCard}`}
          >
            <div className={styles.sectionTitle}>
              <div>
                <h2>Captured revenue by day</h2>
                <p>
                  Verified subscription payments during the past seven India
                  calendar days
                </p>
              </div>
              <span className={styles.eyebrowTag}>LAST 7 DAYS</span>
            </div>
            <div className={styles.revenueRows}>
              {latest.map((day) => (
                <div className={styles.revenueRow} key={day.date}>
                  <span>{day.date.slice(5)}</span>
                  <div
                    className={styles.revenueTrack}
                    aria-label={`${day.date}: ${money(day.capturedPaise)} captured`}
                    role="img"
                  >
                    <div
                      className={styles.revenueFill}
                      style={{
                        width: `${(day.capturedPaise / maxCaptured) * 100}%`,
                      }}
                    />
                  </div>
                  <strong>{money(day.capturedPaise)}</strong>
                </div>
              ))}
            </div>
            <p className={styles.note}>
              Full refunds in this period:{" "}
              {money(latest.reduce((sum, day) => sum + day.refundsPaise, 0))}.
              This is not settlement after fees.
            </p>
          </section>

          <section
            className={`${styles.glass} ${styles.pad} ${styles.sectionCard}`}
          >
            <div className={styles.sectionTitle}>
              <div>
                <h2>Recent verified payments</h2>
                <p>Only worker-accepted subscription charges appear here.</p>
              </div>
              <Link className={styles.textLink} href="/admin/payments">
                View all <ArrowUpRight aria-hidden="true" size={14} />
              </Link>
            </div>
            {data.recentPayments.length === 0 ? (
              <div className={styles.empty}>No verified charges yet.</div>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Plan</th>
                      <th>Paid</th>
                      <th>Amount</th>
                      <th>State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentPayments.map((payment) => (
                      <tr key={payment.id}>
                        <td>
                          <Link href={`/admin/customers/${payment.userId}`}>
                            {payment.email}
                          </Link>
                        </td>
                        <td>{payment.plan}</td>
                        <td className={styles.nowrap}>
                          {dateTime(payment.paidAt)}
                        </td>
                        <td>
                          <strong>{money(payment.amountPaise)}</strong>
                        </td>
                        <td>
                          <span
                            className={`${styles.pill} ${payment.refundedAt ? styles.pillMuted : ""}`}
                          >
                            {payment.refundedAt ? "Refunded" : "Captured"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <p className={styles.note}>
            <Activity aria-hidden="true" size={13} /> Updated{" "}
            {dateTime(data.asOf)}. Revenue excludes full refunds, but does not
            represent Razorpay settlement or fees.
          </p>
        </>
      )}
    </>
  );
}
