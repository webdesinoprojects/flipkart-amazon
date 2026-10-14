"use client";

import {
  describeOutputLayout,
  describeOutputVolume,
  type Batch,
  type BatchDocument,
  type BatchLabel,
  type PdfRect,
} from "@label-normalizer/core";
import { StatusBadge } from "@label-normalizer/ui";
import { Check, LoaderCircle, RefreshCcw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useBatchStore } from "@/features/batch/batch-store";
import {
  retryOutputLayout,
  selectOutputLayout,
} from "@/features/batch/output-layout-controller";
import { useAutomaticHistory } from "@/features/dashboard/use-automatic-history";
import { OutputLayoutChoice } from "./output-layout-choice";

export function OutputPanel({ batch }: { readonly batch: Batch }) {
  const [view, setView] = useState<"thumbnails" | "list">("thumbnails");
  const [showPreview, setShowPreview] = useState(false);
  const [printMessage, setPrintMessage] = useState<string | null>(null);
  const outputLayout = useBatchStore((state) => state.outputLayout);
  const outputStatus = useBatchStore((state) => state.outputStatus);
  const outputError = useBatchStore((state) => state.outputError);
  const {
    state: saveState,
    message: saveMessage,
    retry: retrySave,
  } = useAutomaticHistory(batch);

  const labels = [...batch.labels].sort(
    (left, right) => left.outputOrder - right.outputOrder,
  );
  // One object drives preview, download, print, and history — and only when it
  // actually matches the selected layout. While a variant is generating or
  // after it failed there is nothing truthful to act on, so the actions are
  // unavailable rather than silently serving the other format.
  const artifact =
    batch.combinedPdf?.layout === outputLayout ? batch.combinedPdf : null;
  const generating = outputStatus === "generating";
  const descriptor = describeOutputLayout(outputLayout);
  const previewDisabled = generating || !artifact?.objectUrl;
  const exportDisabled = previewDisabled || saveState !== "saved";

  function changeLayout(next: typeof outputLayout): void {
    setPrintMessage(null);
    setShowPreview(false);
    void selectOutputLayout(next);
  }

  if (labels.length === 0 && batch.status !== "ready") return null;

  return (
    <section className="panel output-panel" aria-labelledby="output-title">
      <div className="panel-heading output-heading">
        <div>
          <span className="eyebrow">FINAL BATCH</span>
          <h2 id="output-title">{descriptor.filename}</h2>
        </div>
        <div className="output-actions">
          <span
            className="save-history-action"
            data-status={saveState}
            role="status"
          >
            {saveState === "saving" ? (
              <LoaderCircle aria-hidden="true" className="spin" size={13} />
            ) : saveState === "saved" ? (
              <Check aria-hidden="true" size={13} />
            ) : (
              <LoaderCircle aria-hidden="true" size={13} />
            )}
            {saveState === "saving"
              ? "SAVING TO HISTORY"
              : saveState === "saved"
                ? "SAVED TO HISTORY"
                : saveState === "failed"
                  ? "HISTORY SAVE FAILED"
                  : "WAITING TO SAVE"}
          </span>
          {saveState === "failed" ? (
            <button
              className="retry-history-action"
              disabled={previewDisabled}
              onClick={retrySave}
              type="button"
            >
              <RefreshCcw aria-hidden="true" size={13} /> RETRY SAVE
            </button>
          ) : null}
          <button
            disabled={previewDisabled}
            onClick={() => setShowPreview((current) => !current)}
            type="button"
          >
            PREVIEW
          </button>
          <button
            disabled={exportDisabled}
            onClick={() => artifact && downloadCombinedPdf(artifact)}
            type="button"
          >
            DOWNLOAD PDF
          </button>
          <button
            disabled={exportDisabled}
            onClick={() => {
              const opened = artifact ? printCombinedPdf(artifact) : false;
              setPrintMessage(
                opened
                  ? `Print window opened for ${describeOutputVolume(
                      artifact?.labelCount ?? batch.counts.labelsReady,
                      outputLayout,
                    ).toLowerCase()} (${descriptor.shortLabel}).`
                  : "The browser blocked the print window. Allow popups and try again.",
              );
            }}
            type="button"
          >
            PRINT ALL
          </button>
        </div>
      </div>

      <OutputLayoutChoice
        errorMessage={outputError}
        labelCount={artifact?.labelCount ?? batch.counts.labelsReady}
        onChange={changeLayout}
        onRetry={() => void retryOutputLayout()}
        status={outputStatus}
        value={outputLayout}
      />

      <div className="output-toolbar">
        <p>
          {`${batch.counts.documentsTotal} PDFs / ${batch.counts.sourcePages} SOURCE PAGES / ${batch.counts.labelsDiscovered} LABELS / ${batch.counts.labelsReady} READY / ${batch.counts.reviewRequired} REVIEW / ${batch.counts.labelsFailed + batch.counts.documentsFailed} FAILED`}
        </p>
        <div>
          <button
            aria-pressed={view === "thumbnails"}
            onClick={() => setView("thumbnails")}
            type="button"
          >
            THUMBNAILS
          </button>
          <button
            aria-pressed={view === "list"}
            onClick={() => setView("list")}
            type="button"
          >
            LIST
          </button>
        </div>
      </div>

      {printMessage && (
        <p className="output-message" role="status">
          {printMessage}
        </p>
      )}
      {saveMessage && (
        <p className="output-message" data-status={saveState} role="status">
          {saveMessage}
          {saveState === "saved" && (
            <Link href="/dashboard/history"> VIEW HISTORY</Link>
          )}
        </p>
      )}
      {showPreview && artifact?.objectUrl && (
        <div className="combined-preview">
          <iframe
            src={artifact.objectUrl}
            title={`Combined PDF preview: ${describeOutputVolume(
              artifact.labelCount,
              artifact.layout,
            ).toLowerCase()}`}
          />
        </div>
      )}

      <div className={`label-results label-results--${view}`}>
        {labels.map((label) => {
          const sourceDocument = batch.documents.find(
            (document) => document.id === label.documentId,
          );
          return (
            <LabelResult
              {...(sourceDocument ? { document: sourceDocument } : {})}
              key={label.id}
              label={label}
              view={view}
            />
          );
        })}
      </div>
    </section>
  );
}

function LabelResult({
  label,
  document,
  view,
}: {
  readonly label: BatchLabel;
  readonly document?: BatchDocument;
  readonly view: "thumbnails" | "list";
}) {
  const page = document?.pages.find((item) => item.id === label.pageId);
  const crop = page?.geometry
    ? pdfRectToPercent(label.region.boundsPt, page.geometry.mediaBox)
    : undefined;
  const decoded = label.validation?.machineReadableCodes.filter(
    (code) => code.decoded,
  ).length;
  return (
    <article className="label-result" data-status={label.status}>
      {view === "thumbnails" && (
        <div className="label-thumbnail">
          {page?.preview ? (
            // Source-preview thumbnail only; final output remains the native PDF.
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="" src={page.preview.objectUrl} />
          ) : (
            <span>NO PREVIEW</span>
          )}
          {crop && <i style={crop} />}
        </div>
      )}
      <div className="label-result-copy">
        <div>
          <strong>
            LABEL {(label.outputOrder + 1).toString().padStart(2, "0")}
          </strong>
          <StatusBadge status={label.status} />
        </div>
        <p>
          {label.marketplace.toUpperCase()} / SOURCE PAGE{" "}
          {label.sourcePageNumber}
          {label.normalized ? " / 100 × 150 MM" : ""}
        </p>
        <small>
          {decoded ?? 0} DECODED
          {label.duplicateOf ? " / DUPLICATE WARNING" : ""}
          {label.error ? ` / ${label.error.code}` : ""}
        </small>
      </div>
    </article>
  );
}

export function downloadCombinedPdf(artifact: {
  readonly filename: string;
  readonly objectUrl?: string;
}): void {
  if (!artifact.objectUrl) return;
  const anchor = document.createElement("a");
  anchor.href = artifact.objectUrl;
  anchor.download = artifact.filename;
  anchor.click();
}

export function printCombinedPdf(artifact: {
  readonly objectUrl?: string;
}): boolean {
  if (!artifact.objectUrl) return false;
  const printWindow = window.open(artifact.objectUrl, "_blank");
  if (!printWindow) return false;
  let invoked = false;
  const invokePrint = () => {
    if (invoked) return;
    invoked = true;
    printWindow.focus();
    printWindow.print();
  };
  printWindow.addEventListener("load", invokePrint, { once: true });
  window.setTimeout(invokePrint, 750);
  return true;
}

function pdfRectToPercent(rect: PdfRect, media: PdfRect) {
  return {
    left: `${((rect.x - media.x) / media.width) * 100}%`,
    top: `${((media.y + media.height - rect.y - rect.height) / media.height) * 100}%`,
    width: `${(rect.width / media.width) * 100}%`,
    height: `${(rect.height / media.height) * 100}%`,
  };
}
