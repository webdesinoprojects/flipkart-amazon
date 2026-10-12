import {
  describeOutputLayout,
  describeOutputVolume,
} from "@label-normalizer/core";
import { ChevronLeft, ChevronRight, FileClock, Tags } from "lucide-react";
import Link from "next/link";
import { DashboardPage } from "@/features/dashboard/page-shell";
import { HistoryControls } from "@/features/dashboard/history-controls";
import { HistoryActions } from "@/features/dashboard/history-preview";
import {
  savedBatchHistory,
  type SavedBatchHistoryQuery,
} from "@/features/dashboard/server-api";
import styles from "@/features/dashboard/dashboard.module.css";

export const metadata = { title: "Batch history" };

type HistorySearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

export default async function BatchHistoryPage({
  searchParams,
}: {
  searchParams: HistorySearchParams;
}) {
  const requested = await searchParams;
  const filters = parseFilters(requested);
  const history = await savedBatchHistory(filters);
  const hasFilters = Boolean(
    filters.query ||
    filters.period !== "all" ||
    filters.marketplace !== "all" ||
    filters.size !== "all" ||
    filters.sort !== "newest",
  );
  const page = Math.floor((filters.offset ?? 0) / (filters.limit ?? 20)) + 1;
  const pageCount = history
    ? Math.max(1, Math.ceil(history.total / history.limit))
    : 1;

  return (
    <DashboardPage
      eyebrow="WORKSPACE / BATCH HISTORY"
      title="Your generated label batches."
      description="Search, preview, and download generated combined PDFs saved automatically after each completed batch. Original marketplace documents and customer details are never indexed here."
      action={
        <Link className={styles.primaryAction} href="/dashboard/labels">
          <Tags aria-hidden="true" size={15} /> NEW BATCH
        </Link>
      }
    >
      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2>Saved batches</h2>
            <p>
              {history
                ? `${history.total.toLocaleString("en-IN")} matching retained outputs`
                : "History could not be loaded from the API."}
            </p>
          </div>
        </div>

        <HistoryControls total={history?.total ?? 0} />

        {!history || history.items.length === 0 ? (
          <div className={styles.emptyState}>
            <div>
              <FileClock aria-hidden="true" size={28} strokeWidth={1.5} />
              <strong>
                {!history
                  ? "HISTORY UNAVAILABLE"
                  : hasFilters
                    ? "NO MATCHING BATCHES"
                    : "NO SAVED BATCHES YET"}
              </strong>
              <span>
                {!history
                  ? "Refresh after the backend reconnects. Local processing is unaffected."
                  : hasFilters
                    ? "Change or reset the filters to widen this result set."
                    : "Finish a label batch and its generated PDF will appear here automatically."}
              </span>
            </div>
          </div>
        ) : (
          <>
            <div className={styles.historyTable}>
              <div className={styles.historyHeader} aria-hidden="true">
                <span>SAVED / BATCH</span>
                <span>MARKETPLACES</span>
                <span>SOURCE</span>
                <span>OUTPUT</span>
                <span>RETAINS UNTIL</span>
                <span>ACTION</span>
              </div>
              {history.items.map((batch) => (
                <div className={styles.historyRow} key={batch.id}>
                  <div className={styles.historyIdentity}>
                    <strong>{formatDate(batch.createdAt, true)}</strong>
                    <span title={batch.clientBatchId}>
                      {compactBatchId(batch.clientBatchId)}
                    </span>
                  </div>
                  <span>{formatMarketplaces(batch.marketplaceCounts)}</span>
                  <span>
                    {batch.sourceDocumentCount} PDF / {batch.sourcePageCount}{" "}
                    PAGES
                  </span>
                  <span>
                    {describeOutputVolume(
                      batch.labelsReady,
                      batch.outputLayout,
                    )}{" "}
                    / {formatBytes(batch.outputSizeBytes)}
                  </span>
                  <span>{formatDate(batch.expiresAt, false)}</span>
                  <HistoryActions
                    batchLabel={compactBatchId(batch.clientBatchId)}
                    downloadUrl={batch.downloadUrl}
                    filename={describeOutputLayout(batch.outputLayout).filename}
                    previewUrl={batch.previewUrl}
                  />
                </div>
              ))}
            </div>

            <nav
              className={styles.historyPagination}
              aria-label="Batch history pages"
            >
              <span>
                PAGE {page.toLocaleString("en-IN")} OF{" "}
                {pageCount.toLocaleString("en-IN")}
              </span>
              <div>
                {history.offset > 0 ? (
                  <Link
                    aria-label="Previous history page"
                    href={paginationHref(
                      requested,
                      Math.max(0, history.offset - history.limit),
                    )}
                  >
                    <ChevronLeft aria-hidden="true" size={14} /> PREVIOUS
                  </Link>
                ) : (
                  <span aria-disabled="true">
                    <ChevronLeft aria-hidden="true" size={14} /> PREVIOUS
                  </span>
                )}
                {history.hasMore ? (
                  <Link
                    aria-label="Next history page"
                    href={paginationHref(
                      requested,
                      history.offset + history.limit,
                    )}
                  >
                    NEXT <ChevronRight aria-hidden="true" size={14} />
                  </Link>
                ) : (
                  <span aria-disabled="true">
                    NEXT <ChevronRight aria-hidden="true" size={14} />
                  </span>
                )}
              </div>
            </nav>
          </>
        )}
      </article>
    </DashboardPage>
  );
}

function parseFilters(
  params: Awaited<HistorySearchParams>,
): SavedBatchHistoryQuery {
  const period = oneOf(
    single(params.period),
    ["all", "today", "7d", "30d", "90d"],
    "all",
  );
  const marketplace = oneOf(
    single(params.marketplace),
    ["all", "amazon", "flipkart", "meesho", "unknown"],
    "all",
  );
  const size = oneOf(
    single(params.size),
    ["all", "under_1mb", "1_to_5mb", "over_5mb"],
    "all",
  );
  const sort = oneOf(
    single(params.sort),
    ["newest", "oldest", "largest", "smallest", "labels_desc"],
    "newest",
  );
  const requestedLimit = Number(single(params.limit));
  const limit =
    ([10, 20, 50] as const).find((value) => value === requestedLimit) ?? 20;
  const requestedOffset = Number(single(params.offset));
  const offset = Number.isSafeInteger(requestedOffset)
    ? Math.min(10_000, Math.max(0, requestedOffset))
    : 0;
  const query = single(params.q).trim().slice(0, 80);
  return {
    ...(query ? { query } : {}),
    period,
    marketplace,
    size,
    sort,
    limit,
    offset,
  };
}

function oneOf<const Values extends readonly string[]>(
  value: string,
  values: Values,
  fallback: Values[number],
): Values[number] {
  return values.includes(value) ? (value as Values[number]) : fallback;
}

function single(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function paginationHref(
  current: Awaited<HistorySearchParams>,
  offset: number,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(current)) {
    const scalar = single(value);
    if (scalar && key !== "offset") params.set(key, scalar);
  }
  if (offset > 0) params.set("offset", String(offset));
  const query = params.toString();
  return query ? `/dashboard/history?${query}` : "/dashboard/history";
}

function formatDate(value: string, time: boolean): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(time ? { hour: "2-digit", minute: "2-digit" } : {}),
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

function formatMarketplaces(counts: Record<string, number>): string {
  return (
    Object.entries(counts)
      .filter(([, count]) => count > 0)
      .map(([name, count]) => `${name.toUpperCase()} ${count}`)
      .join(" / ") || "UNCLASSIFIED"
  );
}

function compactBatchId(value: string): string {
  return value.length > 28 ? `${value.slice(0, 25)}...` : value;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
