import Link from "next/link";
import {
  AdminPageHeader,
  AdminUnavailable,
} from "@/features/admin/page-header";
import { AdminPagination, cleanOffset } from "@/features/admin/pagination";
import { adminAudit } from "@/features/admin/server-api";
import { dateTime, number } from "@/features/admin/format";
import styles from "@/features/admin/admin.module.css";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const offset = cleanOffset((await searchParams).offset);
  const data = await adminAudit(offset);
  return (
    <>
      <AdminPageHeader
        eyebrow="SECURITY / AUDIT TRAIL"
        title="Actions leave a trace."
        description="Sanitized account and security events. Passwords, tokens, customer PDFs and full IP addresses are never kept in this trail."
      />
      {!data ? (
        <AdminUnavailable />
      ) : (
        <section className={`${styles.glass} ${styles.pad}`}>
          <div className={styles.sectionTitle}>
            <div>
              <h2>Security events</h2>
              <p>{number(data.total)} records</p>
            </div>
            <span className={styles.eyebrowTag}>REDACTED</span>
          </div>
          {data.items.length === 0 ? (
            <div className={styles.empty}>No audit events yet.</div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Outcome</th>
                    <th>When</th>
                    <th>Actor</th>
                    <th>Subject</th>
                    <th>Request</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((event) => (
                    <tr key={event.id}>
                      <td>
                        <strong>{event.event}</strong>
                      </td>
                      <td>
                        <span
                          className={`${styles.pill} ${event.outcome === "success" ? "" : styles.pillWarning}`}
                        >
                          {event.outcome}
                        </span>
                      </td>
                      <td className={styles.nowrap}>
                        {dateTime(event.createdAt)}
                      </td>
                      <td>
                        <code>{event.actorUserId?.slice(0, 8) ?? "—"}</code>
                      </td>
                      <td>
                        {event.subjectUserId ? (
                          <Link
                            href={`/admin/customers/${event.subjectUserId}`}
                          >
                            {event.subjectUserId.slice(0, 8)}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        <code>{event.requestId?.slice(0, 8) ?? "—"}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <AdminPagination
            basePath="/admin/audit"
            total={data.total}
            offset={data.offset}
            limit={data.limit}
          />
        </section>
      )}
    </>
  );
}
