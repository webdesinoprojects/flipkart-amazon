/** Mirrors `OutputLayout` in `@label-normalizer/core`. */
export type SavedOutputLayout = "label_100x150" | "a4_4up";

export interface SavedBatch {
  id: string;
  clientBatchId: string;
  status: "saved";
  sourceDocumentCount: number;
  sourcePageCount: number;
  labelsDiscovered: number;
  labelsReady: number;
  reviewRequired: number;
  labelsFailed: number;
  duplicateWarnings: number;
  /** Physical pages in the saved PDF: label pages, or A4 sheets. */
  outputPageCount: number;
  outputLayout: SavedOutputLayout;
  marketplaceCounts: Record<string, number>;
  outputSizeBytes: number;
  createdAt: string;
  expiresAt: string;
  previewUrl: string;
  downloadUrl: string;
}

export interface DailyUsage {
  date: string;
  labels: number;
  batches: number;
}

export interface DashboardSummary {
  usageToday: number;
  batchesToday: number;
  totalLabels: number;
  totalBatches: number;
  availableCredits: number | null;
  activePlan: string | null;
  dailyUsage: DailyUsage[];
  recentBatches: SavedBatch[];
}

export interface SavedBatchList {
  items: SavedBatch[];
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
}
