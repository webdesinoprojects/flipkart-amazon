"use client";

import { describeOutputVolume } from "@label-normalizer/core";
import { StatusBadge } from "@label-normalizer/ui";
import { useState } from "react";
import { DocumentList } from "./document-list";
import { FileDropzone } from "./file-dropzone";
import { PreviewPanel } from "./preview-panel";
import { ProcessPanel } from "./process-panel";
import { ReviewPanel } from "./review-panel";
import { OutputPanel } from "./output-panel";
import { useBatchStore } from "@/features/batch/batch-store";
import {
  cancelActiveBatch,
  processBatchFiles,
} from "@/features/batch/pdf-engine";

export function Workspace({
  embedded = false,
}: {
  readonly embedded?: boolean;
}) {
  const batch = useBatchStore((state) => state.batch);
  const selectedDocumentId = useBatchStore((state) => state.selectedDocumentId);
  const selectedPageId = useBatchStore((state) => state.selectedPageId);
  const selectDocument = useBatchStore((state) => state.selectDocument);
  const selectPage = useBatchStore((state) => state.selectPage);
  const reset = useBatchStore((state) => state.reset);
  const [fatalMessage, setFatalMessage] = useState<string | null>(null);

  const selectedDocument =
    batch?.documents.find((document) => document.id === selectedDocumentId) ??
    null;
  const isRunning = [
    "ingesting",
    "parsing",
    "classifying",
    "extracting",
    "normalizing",
    "assembling",
  ].includes(batch?.status ?? "");

  function start(files: readonly File[]): void {
    setFatalMessage(null);
    void processBatchFiles(files).catch(() => {
      setFatalMessage(
        "The local processing run stopped unexpectedly. Your files were not uploaded.",
      );
    });
  }

  function clearBatch(): void {
    cancelActiveBatch();
    setFatalMessage(null);
    reset();
  }

  return (
    <main className={`app-shell${embedded ? " app-shell--embedded" : ""}`}>
      {!embedded && (
        <header className="site-header">
          <a className="brand" href="#top" id="top">
            SELLERLABEL
          </a>
          <div className="header-meta">
            <span>LOCAL-FIRST</span>
            <span>PHASE 10</span>
          </div>
        </header>
      )}

      {!batch ? (
        <section className="landing">
          <div className="landing-copy">
            <span className="eyebrow">
              MARKETPLACE SHIPPING PDFS → ONE PRINT FORMAT
            </span>
            <h1>
              INSPECT EVERY
              <br />
              SOURCE PAGE.
            </h1>
            <p>
              Mixed marketplace batches, normalized locally with explainable
              adapters, native PDF output, machine-readable validation, and
              review only where evidence is uncertain.
            </p>
          </div>
          <FileDropzone onFiles={start} />
          <div className="principle-strip">
            <span>01 / LOCAL PROCESSING</span>
            <span>02 / PDF-NATIVE OUTPUT</span>
            <span>03 / NO SCREENSHOTS FOR PRINT</span>
          </div>
        </section>
      ) : (
        <>
          <section className="batch-masthead">
            <div>
              <span className="eyebrow">CURRENT BATCH</span>
              <h1>{shortBatchId(batch.id)}</h1>
            </div>
            <div className="batch-actions">
              <StatusBadge status={batch.status} />
              <button
                className="text-button"
                disabled={isRunning}
                onClick={clearBatch}
                type="button"
              >
                NEW BATCH
              </button>
            </div>
          </section>

          {fatalMessage && (
            <div className="fatal-banner" role="alert">
              {fatalMessage}
            </div>
          )}

          <section className="workspace-grid">
            <aside className="batch-summary panel">
              <span className="eyebrow">BATCH</span>
              <dl>
                <SummaryDatum
                  label="PDFS"
                  value={batch.counts.documentsTotal}
                />
                <SummaryDatum
                  label="SOURCE PAGES"
                  value={batch.counts.sourcePages}
                />
                <SummaryDatum
                  label="LABELS FOUND"
                  value={batch.counts.labelsDiscovered}
                />
                <SummaryDatum
                  label="REVIEW"
                  value={batch.counts.reviewRequired}
                />
                <SummaryDatum
                  label="READY LABELS"
                  value={batch.counts.labelsReady}
                />
                <SummaryDatum
                  label="FAILED"
                  value={
                    batch.counts.documentsFailed + batch.counts.labelsFailed
                  }
                />
              </dl>
              <FileDropzone compact disabled={isRunning} onFiles={start} />
              <p className="phase-note">
                Confirmed Flipkart, Amazon, and Meesho layouts are
                deterministic. Unknown layouts are retained conservatively for
                review instead of discarded.
              </p>
              {batch.combinedPdf && (
                <p className="phase-note" data-testid="combined-artifact">
                  {batch.combinedPdf.filename} /{" "}
                  {describeOutputVolume(
                    batch.combinedPdf.labelCount,
                    batch.combinedPdf.layout,
                  )}
                </p>
              )}
            </aside>

            <ProcessPanel batch={batch} />
            <DocumentList
              documents={batch.documents}
              onSelect={selectDocument}
              selectedDocumentId={selectedDocumentId}
            />
            <PreviewPanel
              document={selectedDocument}
              onSelectPage={(pageId) => {
                if (selectedDocument) selectPage(selectedDocument.id, pageId);
              }}
              selectedPageId={selectedPageId}
            />
            <ReviewPanel />
            <OutputPanel batch={batch} />
          </section>

          <footer className="batch-footer">
            <span>
              {batch.counts.sourcePages} PAGES INSPECTED · {batch.events.length}{" "}
              AUDIT EVENTS
            </span>
            <span>OUTPUT ACTIONS LOCKED UNTIL PHASE 5+</span>
          </footer>
        </>
      )}
    </main>
  );
}

function SummaryDatum({
  label,
  value,
}: {
  readonly label: string;
  readonly value: number;
}) {
  return (
    <div>
      <dd>{value.toString().padStart(2, "0")}</dd>
      <dt>{label}</dt>
    </div>
  );
}

function shortBatchId(batchId: string): string {
  return `BATCH / ${batchId.slice(-8).toUpperCase()}`;
}
