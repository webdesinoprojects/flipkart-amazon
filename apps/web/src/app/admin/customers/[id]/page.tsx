import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import {
  AdminPageHeader,
  AdminUnavailable,
} from "@/features/admin/page-header";
import { adminCustomer } from "@/features/admin/server-api";
import { dateTime, money, number } from "@/features/admin/format";
import { CreditGrantDialog } from "@/features/admin/credit-grant-dialog";
import styles from "@/features/admin/admin.module.css";

export default async function AdminCustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await adminCustomer(id);
  return (
    <>
      <AdminPageHeader
        eyebrow="CUSTOMER / ACCOUNT DETAIL"
        title={data?.email ?? "Customer unavailable"}
        description="Verified plan capacity, saved-label usage and billing history for this account."
        action={
          <Link className={styles.buttonLink} href="/admin/customers">
            <ArrowLeft aria-hidden="true" size={15} /> All customers
          </Link>
        }
      />
      {!data ? (
        <AdminUnavailable />
      ) : (
        <>
          <div className={styles.detailGrid}>
            <div
              className={`${styles.glassDark} ${styles.pad} ${styles.detailStat}`}
            >
              <span>Current plan</span>
              <strong>{data.plan}</strong>
            </div>
            <div
              className={`${styles.glass} ${styles.pad} ${styles.detailStat}`}
            >
              <span>Daily allowance</span>
              <strong>{number(data.dailyCredits)}</strong>
            </div>
            <div
              className={`${styles.glassGreen} ${styles.pad} ${styles.detailStat}`}
            >
              <span>Used today</span>
              <strong>{number(data.usedToday)}</strong>
            </div>
            <div
              className={`${styles.glass} ${styles.pad} ${styles.detailStat}`}
            >
              <span>One-time credits</span>
              <strong>{number(data.bonusCredits)}</strong>
            </div>
          </div>
          <section
            className={`${styles.glass} ${styles.pad} ${styles.sectionCard}`}
          >
            <div className={styles.sectionTitle}>
              <div>
                <h2>Credit support</h2>
                <p>
                  Grant a fixed pool for this customer; it expires and never
                  refills daily.
                </p>
              </div>
              <CreditGrantDialog customerId={data.id} email={data.email} />
            </div>
            <p className={styles.note}>
              All-time labels: {number(data.totalLabels)} · Saved batches:{" "}
              {number(data.savedBatches)}
            </p>
            {data.creditGrants.length === 0 ? (
              <div className={styles.empty}>No one-time credit grants.</div>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Granted</th>
                      <th>Remaining</th>
                      <th>Reason</th>
                      <th>Expires</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.creditGrants.map((grant) => (
                      <tr key={grant.id}>
                        <td>
                          {number(grant.amount)}
                          <small>{dateTime(grant.createdAt)}</small>
                        </td>
                        <td>
                          <strong>{number(grant.remaining)}</strong>
                        </td>
                        <td>{grant.reason}</td>
                        <td className={styles.nowrap}>
                          {dateTime(grant.expiresAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <div className={styles.detailSections}>
            <section className={`${styles.glass} ${styles.pad}`}>
              <div className={styles.sectionTitle}>
                <div>
                  <h2>Account</h2>
                  <p>Customer ID: {data.id}</p>
                </div>
              </div>
              <div className={styles.detailList}>
                <div className={styles.detailItem}>
                  <strong>Status</strong>
                  <span>
                    {data.status} ·{" "}
                    {data.emailVerified ? "email verified" : "email unverified"}
                  </span>
                </div>
                <div className={styles.detailItem}>
                  <strong>Created</strong>
                  <span>{dateTime(data.createdAt)}</span>
                </div>
                <div className={styles.detailItem}>
                  <strong>Last sign-in</strong>
                  <span>{dateTime(data.lastLoginAt)}</span>
                </div>
                <div className={styles.detailItem}>
                  <strong>Saved batches</strong>
                  <span>{number(data.savedBatches)}</span>
                </div>
              </div>
            </section>
            <section className={`${styles.glass} ${styles.pad}`}>
              <div className={styles.sectionTitle}>
                <div>
                  <h2>Subscriptions</h2>
                  <p>Current and historical mandates</p>
                </div>
              </div>
              {data.subscriptions.length === 0 ? (
                <div className={styles.empty}>No subscription records.</div>
              ) : (
                <div className={styles.detailList}>
                  {data.subscriptions.map((subscription) => (
                    <div className={styles.detailItem} key={subscription.id}>
                      <strong>
                        {subscription.plan} · {subscription.status}
                      </strong>
                      <span>
                        Paid through {dateTime(subscription.paidThrough)} ·{" "}
                        {subscription.cancelAtCycleEnd
                          ? "renewal cancelled"
                          : "renewal not cancelled"}
                      </span>
                      <span>{subscription.providerId}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
          <section
            className={`${styles.glass} ${styles.pad} ${styles.sectionCard}`}
          >
            <div className={styles.sectionTitle}>
              <div>
                <h2>Payment history</h2>
                <p>Verified subscription charges only</p>
              </div>
            </div>
            {data.payments.length === 0 ? (
              <div className={styles.empty}>No verified charges.</div>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Payment ID</th>
                      <th>Plan</th>
                      <th>Captured</th>
                      <th>Amount</th>
                      <th>State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.payments.map((payment) => (
                      <tr key={payment.id}>
                        <td>
                          <code>{payment.paymentId}</code>
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
        </>
      )}
    </>
  );
}
