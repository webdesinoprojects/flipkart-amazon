import "server-only";
import { serverRequest } from "@/features/api/server-request";
import type { DashboardSummary, SavedBatchList } from "./contracts";

export interface SavedBatchHistoryQuery {
  query?: string;
  period?: "all" | "today" | "7d" | "30d" | "90d";
  marketplace?: "all" | "amazon" | "flipkart" | "meesho" | "unknown";
  size?: "all" | "under_1mb" | "1_to_5mb" | "over_5mb";
  sort?: "newest" | "oldest" | "largest" | "smallest" | "labels_desc";
  limit?: 10 | 20 | 50;
  offset?: number;
}

export async function dashboardSummary(): Promise<DashboardSummary | null> {
  return (await serverRequest<DashboardSummary>("/api/v1/dashboard/summary"))
    .data;
}

export async function savedBatchHistory(
  filters: SavedBatchHistoryQuery = {},
): Promise<SavedBatchList | null> {
  const params = new URLSearchParams({
    limit: String(filters.limit ?? 20),
    offset: String(filters.offset ?? 0),
  });
  if (filters.query) params.set("q", filters.query);
  if (filters.period && filters.period !== "all") {
    params.set("period", filters.period);
  }
  if (filters.marketplace && filters.marketplace !== "all") {
    params.set("marketplace", filters.marketplace);
  }
  if (filters.size && filters.size !== "all") {
    params.set("size", filters.size);
  }
  if (filters.sort && filters.sort !== "newest") {
    params.set("sort", filters.sort);
  }
  return (
    await serverRequest<SavedBatchList>(`/api/v1/history/batches?${params}`)
  ).data;
}
