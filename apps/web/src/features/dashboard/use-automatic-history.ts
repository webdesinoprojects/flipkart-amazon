"use client";

import type { Batch, CombinedPdfArtifact } from "@label-normalizer/core";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AuthApiError } from "@/features/auth/browser-api";
import { saveBatchToHistory } from "./browser-api";

export type HistorySaveState = "idle" | "saving" | "saved" | "failed";

interface SaveOutcome {
  readonly signature: string;
  readonly state: HistorySaveState;
  readonly message: string | null;
}

/**
 * Identity of one automatic save attempt.
 *
 * The selected layout is part of the signature, so switching layout saves the
 * newly selected output exactly once. The backend replaces the existing record
 * for the same `clientBatchId` rather than creating a second row, so this never
 * produces duplicate history entries.
 */
function signatureFor(batch: Batch, artifact: CombinedPdfArtifact): string {
  // The blob URL changes whenever the underlying PDF is reassembled, even if
  // the layout and physical page count stay the same (for example, approving
  // a fourth label on an existing one-sheet A4 batch). Falling back to the
  // batch timestamp keeps the function usable in non-browser tests.
  const revision = artifact.objectUrl ?? batch.updatedAt;
  return `${batch.id}:${artifact.layout}:${artifact.labelCount}:${artifact.pageCount}:${revision}`;
}

/**
 * Persist the selected combined PDF to private history, automatically.
 *
 * There is deliberately no manual save control: a completed batch is retained
 * as soon as its artifact exists, and again whenever the selected layout
 * changes the artifact.
 */
export function useAutomaticHistory(batch: Batch) {
  const artifact = batch.combinedPdf;
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null);
  const latestQueued = useRef<string | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const router = useRouter();

  const signature = artifact ? signatureFor(batch, artifact) : null;
  const state: HistorySaveState =
    outcome && outcome.signature === signature ? outcome.state : "idle";
  const message =
    outcome && outcome.signature === signature ? outcome.message : null;

  const enqueueSave = useCallback(
    (snapshot: Batch, force = false) => {
      const current = snapshot.combinedPdf;
      if (!current) return;
      const key = signatureFor(snapshot, current);
      if (!force && latestQueued.current === key) return;
      latestQueued.current = key;
      setOutcome({ signature: key, state: "saving", message: null });

      // Serialize replacements. Without this queue, an older, larger thermal
      // upload can finish after a newer A4 upload and overwrite the currently
      // selected history artifact. Superseded requests that have not started
      // are skipped; an in-flight request is followed by the newest selection.
      saveQueue.current = saveQueue.current.then(async () => {
        if (latestQueued.current !== key) return;
        setOutcome({ signature: key, state: "saving", message: null });
        try {
          await saveBatchToHistory(snapshot);
          if (latestQueued.current !== key) return;
          setOutcome({
            signature: key,
            state: "saved",
            message:
              "Saved privately. Original marketplace PDFs stayed in this browser.",
          });
          router.refresh();
        } catch (error) {
          if (latestQueued.current !== key) return;
          setOutcome({
            signature: key,
            state: "failed",
            message:
              error instanceof AuthApiError || error instanceof Error
                ? error.message
                : "The generated PDF could not be saved. Try again.",
          });
        }
      });
    },
    [router],
  );

  useEffect(() => {
    if (!signature) return;
    const timer = window.setTimeout(() => enqueueSave(batch), 0);
    // The signature ref keeps this safe across normal rerenders and React's
    // development-only effect replay. The API is independently idempotent.
    return () => window.clearTimeout(timer);
  }, [batch, enqueueSave, signature]);

  const retry = useCallback(
    () => enqueueSave(batch, true),
    [batch, enqueueSave],
  );

  return { state, message, retry };
}
