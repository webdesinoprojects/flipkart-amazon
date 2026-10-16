import Link from "next/link";
import styles from "./admin.module.css";

export function AdminPagination({
  basePath,
  total,
  offset,
  limit,
  query,
}: {
  basePath: string;
  total: number;
  offset: number;
  limit: number;
  query?: string;
}) {
  const href = (nextOffset: number) => {
    const params = new URLSearchParams({ offset: String(nextOffset) });
    if (query) params.set("q", query);
    return `${basePath}?${params}`;
  };
  return (
    <div className={styles.pagination}>
      <span>
        {total === 0
          ? "No records"
          : `${offset + 1}–${Math.min(offset + limit, total)} of ${total.toLocaleString("en-IN")}`}
      </span>
      <div className={styles.paginationActions}>
        {offset > 0 && (
          <Link
            className={styles.pageButton}
            href={href(Math.max(0, offset - limit))}
          >
            Previous
          </Link>
        )}
        {offset + limit < total && (
          <Link className={styles.pageButton} href={href(offset + limit)}>
            Next
          </Link>
        )}
      </div>
    </div>
  );
}

export function cleanOffset(value: string | string[] | undefined): number {
  const numeric = Number(Array.isArray(value) ? value[0] : value);
  if (!Number.isInteger(numeric) || numeric < 0) return 0;
  return Math.min(numeric, 100_000);
}
