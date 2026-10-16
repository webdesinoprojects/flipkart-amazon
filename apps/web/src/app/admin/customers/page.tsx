import { ArrowUpRight, Search } from "lucide-react";
import Link from "next/link";
import {
  AdminPageHeader,
  AdminUnavailable,
} from "@/features/admin/page-header";
import { AdminPagination, cleanOffset } from "@/features/admin/pagination";
import { adminCustomers } from "@/features/admin/server-api";
import { dateOnly, number } from "@/features/admin/format";
import styles from "@/features/admin/admin.module.css";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const requested = await searchParams;
  const query = (
    Array.isArray(requested.q) ? (requested.q[0] ?? "") : (requested.q ?? "")
  )
    .trim()
    .slice(0, 80);
  const offset = cleanOffset(requested.offset);
  const data = await adminCustomers(query, offset);
  return (
    <>
      <AdminPageHeader
        eyebrow="CUSTOMER DIRECTORY"
        title="Know who you serve."
        description="Search accounts, see verified plan capacity and actual labels saved today. Customer documents are never shown here."
      />
      {!data ? (
        <AdminUnavailable />
      ) : (
        <section className={`${styles.glass} ${styles.pad}`}>
          <div className={styles.sectionTitle}>
            <div>
              <h2>All customers</h2>
              <p>{number(data.total)} matching accounts</p>
            </div>
            <span className={styles.eyebrowTag}>LIVE ACCOUNT DATA</span>
          </div>
          <form
            action="/admin/customers"
            className={styles.filterRow}
            method="get"
          >
            <label className={styles.searchField}>
              <Search aria-hidden="true" size={16} />
              <span className="sr-only">Search customer email</span>
              <input
                autoComplete="off"
                defaultValue={query}
                maxLength={80}
                name="q"
                placeholder="Search by email"
                type="search"
              />
            </label>
            <button className={styles.buttonLink} type="submit">
              Search
            </button>
          </form>
          {data.items.length === 0 ? (
            <div className={styles.empty}>No customers match this search.</div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Plan</th>
                    <th>Today</th>
                    <th>Status</th>
                    <th>Joined</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <strong>{user.email}</strong>
                        <small>
                          {user.emailVerified
                            ? "Email verified"
                            : "Email unverified"}
                        </small>
                      </td>
                      <td>{user.plan}</td>
                      <td className={styles.nowrap}>
                        {number(user.usedToday)} / {number(user.dailyCredits)}
                        {user.bonusCredits > 0 && (
                          <small>
                            + {number(user.bonusCredits)} one-time credits
                          </small>
                        )}
                      </td>
                      <td>
                        <span
                          className={`${styles.pill} ${user.status !== "active" ? styles.pillWarning : ""}`}
                        >
                          {user.status}
                        </span>
                      </td>
                      <td className={styles.nowrap}>
                        {dateOnly(user.createdAt)}
                      </td>
                      <td>
                        <Link
                          href={`/admin/customers/${user.id}`}
                          aria-label={`Open ${user.email}`}
                        >
                          <ArrowUpRight aria-hidden="true" size={17} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <AdminPagination
            basePath="/admin/customers"
            limit={data.limit}
            offset={data.offset}
            query={query}
            total={data.total}
          />
        </section>
      )}
    </>
  );
}
