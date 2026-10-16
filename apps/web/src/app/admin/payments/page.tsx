import Link from "next/link";
import {
  AdminPageHeader,
  AdminUnavailable,
} from "@/features/admin/page-header";
import { AdminPagination, cleanOffset } from "@/features/admin/pagination";
import { adminPayments } from "@/features/admin/server-api";
import { dateTime, money, number } from "@/features/admin/format";
import styles from "@/features/admin/admin.module.css";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const offset = cleanOffset((await searchParams).offset);
  const data = await adminPayments(offset);
  return (
    <>
      <AdminPageHeader
        eyebrow="BILLING / VERIFIED CHARGES"
        title="Every payment, accounted for."
        description="This ledger lists charges accepted after invoice and payment verification. Razorpay remains the source of truth for settlements and refunds."
      />
      {!data ? (
        <AdminUnavailable />
      ) : (
        <section className={`${styles.glass} ${styles.pad}`}>
          <div className={styles.sectionTitle}>
            <div>
              <h2>Subscription payments</h2>
              <p>{number(data.total)} verified charge records</p>
            </div>
            <span className={styles.eyebrowTag}>READ-ONLY</span>
          </div>
          {data.items.length === 0 ? (
            <div className={styles.empty}>No verified charges yet.</div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Payment</th>
                    <th>Customer</th>
                    <th>Plan</th>
                    <th>Captured</th>
                    <th>Amount</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((payment) => (
                    <tr key={payment.id}>
                      <td>
                        <code>{payment.paymentId}</code>
                        <small>{payment.subscriptionId}</small>
                      </td>
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
                          {payment.refundedAt ? "Fully refunded" : "Captured"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <AdminPagination
            basePath="/admin/payments"
            total={data.total}
            offset={data.offset}
            limit={data.limit}
          />
          <p className={styles.note}>
            Amounts are gross subscription charges. Bank settlement, fees and
            partial refunds are not represented by this local record.
          </p>
        </section>
      )}
    </>
  );
}
