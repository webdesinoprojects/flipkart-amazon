import {
  assembleLabelsForLayout,
  type NormalizedLabel,
  type OutputLayout,
} from "@label-normalizer/core";
import { useBatchStore } from "./batch-store";

/**
 * Monotonic token making rapid layout switching race-safe.
 *
 * A slow A4 generation that finishes after the user has already switched back
 * is discarded instead of overwriting the newer choice. The store performs the
 * same check when promoting a variant, so both the in-flight request and the
 * committed selection have to agree.
 */
let requestToken = 0;

/** Approved, normalized labels in source order — the canonical assembly input. */
function readyLabels(): readonly NormalizedLabel[] {
  const batch = useBatchStore.getState().batch;
  return (
    batch?.labels.flatMap((label) =>
      label.status === "success" && label.normalized ? [label.normalized] : [],
    ) ?? []
  );
}

/**
 * Select `layout` and make sure its combined PDF exists.
 *
 * Switching layout only re-imposes labels that were already detected, cropped,
 * reviewed, normalized, and validated. No marketplace work is repeated.
 */
export async function selectOutputLayout(layout: OutputLayout): Promise<void> {
  const store = useBatchStore.getState();
  const batchId = store.batch?.id;
  store.beginOutputLayout(layout);

  if (!batchId || store.outputVariants.has(layout)) return;

  const labels = readyLabels();
  if (labels.length === 0) return;

  const token = ++requestToken;
  try {
    const artifact = await assembleLabelsForLayout(labels, layout);
    if (token !== requestToken) return;
    useBatchStore.getState().setOutputVariant(batchId, layout, artifact);
  } catch {
    if (token !== requestToken) return;
    // Never silently fall back to the other format: the person asked for this
    // one, so surface the failure and let them retry.
    useBatchStore
      .getState()
      .failOutputLayout(
        layout,
        "That output layout could not be generated. Try again.",
      );
  }
}

/** Retry the current selection after a failure. */
export async function retryOutputLayout(): Promise<void> {
  await selectOutputLayout(useBatchStore.getState().outputLayout);
}

/** Test-only hook so one spec's in-flight token cannot leak into the next. */
export function resetOutputLayoutRequests(): void {
  requestToken = 0;
}
