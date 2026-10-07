"use client";

import type { PdfRect } from "@label-normalizer/core";
import { StatusBadge } from "@label-normalizer/ui";
import {
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  approveAllReviewLabels,
  approveReviewLabel,
  redetectReviewLabel,
  skipReviewLabel,
} from "@/features/batch/pdf-engine";
import { useBatchStore } from "@/features/batch/batch-store";

type Rotation = 0 | 90 | 180 | 270;

interface Gesture {
  readonly mode: "move" | "resize";
  readonly clientX: number;
  readonly clientY: number;
  readonly bounds: PdfRect;
}

interface EditorState {
  readonly labelId: string;
  readonly bounds: PdfRect;
  readonly rotation: Rotation;
}

export function ReviewPanel() {
  const batch = useBatchStore((state) => state.batch);
  const reviewLabels = useMemo(
    () =>
      batch?.labels.filter((label) => label.status === "review_required") ?? [],
    [batch],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    reviewLabels.find((label) => label.id === selectedId) ??
    reviewLabels[0] ??
    null;
  const document = batch?.documents.find(
    (item) => item.id === selected?.documentId,
  );
  const page = document?.pages.find((item) => item.id === selected?.pageId);
  const [edits, setEdits] = useState<EditorState | null>(null);
  const draft = selected
    ? edits?.labelId === selected.id
      ? edits.bounds
      : selected.region.boundsPt
    : null;
  const rotation = selected
    ? edits?.labelId === selected.id
      ? edits.rotation
      : (selected.region.rotation ?? 0)
    : 0;
  const gestureRef = useRef<Gesture | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  if (!batch || !selected || !page?.geometry || !draft) return null;
  const activeGeometry = page.geometry;
  const activeLabelId = selected.id;

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage(success);
    } catch {
      setMessage(
        "The review action could not be completed; the label is unchanged.",
      );
    } finally {
      setBusy(false);
    }
  }

  function updateCrop(event: ReactPointerEvent<HTMLElement>) {
    const activeGesture = gestureRef.current;
    const canvas = canvasRef.current;
    if (!activeGesture || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dx =
      ((event.clientX - activeGesture.clientX) / rect.width) *
      activeGeometry.widthPt;
    const dy =
      ((event.clientY - activeGesture.clientY) / rect.height) *
      activeGeometry.heightPt;
    const bounds =
      activeGesture.mode === "move"
        ? moveBounds(activeGesture.bounds, dx, dy, activeGeometry.mediaBox)
        : resizeBounds(activeGesture.bounds, dx, dy, activeGeometry.mediaBox);
    setEdits({ labelId: activeLabelId, bounds, rotation });
  }

  const overlay = pdfRectToPercent(draft, page.geometry.mediaBox);
  const decoded = selected.validation?.machineReadableCodes.filter(
    (code) => code.decoded,
  ).length;

  return (
    <section className="panel review-panel" aria-labelledby="review-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">MANUAL REVIEW</span>
          <h2 id="review-title">
            LABEL {(selected.outputOrder + 1).toString().padStart(2, "0")}
          </h2>
        </div>
        <StatusBadge status="review_required" />
      </div>

      <div className="review-layout">
        <div>
          <div
            className="review-canvas"
            onPointerMove={updateCrop}
            onPointerUp={() => {
              gestureRef.current = null;
            }}
            ref={canvasRef}
            style={{
              aspectRatio: `${page.preview?.widthPx ?? page.geometry.widthPt} / ${page.preview?.heightPx ?? page.geometry.heightPt}`,
            }}
          >
            {page.preview ? (
              // This raster is an editor preview only; reprocessing uses the source PDF.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt="Source page for manual crop review"
                src={page.preview.objectUrl}
              />
            ) : (
              <span>PREVIEW UNAVAILABLE</span>
            )}
            <div
              className="crop-overlay"
              data-testid="crop-overlay"
              onPointerMove={updateCrop}
              onPointerUp={() => {
                gestureRef.current = null;
              }}
              onPointerDown={(event) => {
                event.preventDefault();
                gestureRef.current = {
                  mode: "move",
                  clientX: event.clientX,
                  clientY: event.clientY,
                  bounds: draft,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              style={overlay}
            >
              <span>CROP</span>
              <button
                aria-label="Resize crop"
                className="crop-handle"
                onPointerMove={updateCrop}
                onPointerUp={() => {
                  gestureRef.current = null;
                }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  gestureRef.current = {
                    mode: "resize",
                    clientX: event.clientX,
                    clientY: event.clientY,
                    bounds: draft,
                  };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                type="button"
              />
            </div>
          </div>
          <p className="review-help">
            Drag the crop rectangle. Drag its lower-right square to resize. All
            coordinates are converted back to PDF points before native output.
          </p>
        </div>

        <div className="review-controls">
          <dl className="technical-grid review-data">
            <Datum label="MARKETPLACE" value={selected.marketplace} />
            <Datum
              label="CROP PT"
              value={`${draft.x.toFixed(1)}, ${draft.y.toFixed(1)}, ${draft.width.toFixed(1)} × ${draft.height.toFixed(1)}`}
            />
            <Datum label="ROTATION" value={`${rotation}°`} />
            <Datum
              label="CONFIDENCE"
              value={
                selected.validation
                  ? `${Math.round(selected.validation.confidence * 100)}%`
                  : "Not confirmed"
              }
            />
            <Datum label="DECODED" value={`${decoded ?? 0}`} />
            <Datum
              label="CLIP RISK"
              value={
                selected.validation
                  ? `${Math.round(selected.validation.contentClippingRisk * 100)}%`
                  : "Unknown"
              }
            />
          </dl>

          <div className="rotation-controls" aria-label="Output rotation">
            {([0, 90, 180, 270] as const).map((value) => (
              <button
                aria-pressed={rotation === value}
                key={value}
                onClick={() =>
                  setEdits({
                    labelId: selected.id,
                    bounds: draft,
                    rotation: value,
                  })
                }
                type="button"
              >
                {value}°
              </button>
            ))}
          </div>

          <div className="review-actions">
            <button
              disabled={busy}
              onClick={() =>
                void run(
                  () => redetectReviewLabel(selected.id, draft, rotation),
                  "Re-detection complete. Review the new evidence before approval.",
                )
              }
              type="button"
            >
              RE-DETECT
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(
                  () => approveReviewLabel(selected.id),
                  "Label approved.",
                )
              }
              type="button"
            >
              APPROVE
            </button>
            {reviewLabels.length > 1 && (
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await approveAllReviewLabels();
                  }, `${reviewLabels.length} labels approved.`)
                }
                title="Approve every label currently waiting for manual review"
                type="button"
              >
                APPROVE ALL ({reviewLabels.length})
              </button>
            )}
            <button
              disabled={busy}
              onClick={() => downloadSingleLabel(selected)}
              type="button"
            >
              DOWNLOAD LABEL
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(() => skipReviewLabel(selected.id), "Label skipped.")
              }
              type="button"
            >
              SKIP
            </button>
          </div>
          {message && <p className="review-message">{message}</p>}
        </div>
      </div>

      <div className="review-queue" aria-label="Review queue">
        {reviewLabels.map((label) => (
          <button
            aria-pressed={label.id === selected.id}
            key={label.id}
            onClick={() => {
              setSelectedId(label.id);
              setMessage(null);
            }}
            type="button"
          >
            {(label.outputOrder + 1).toString().padStart(2, "0")} /{" "}
            {label.marketplace}
          </button>
        ))}
      </div>
    </section>
  );
}

function pdfRectToPercent(rect: PdfRect, media: PdfRect) {
  return {
    left: `${((rect.x - media.x) / media.width) * 100}%`,
    top: `${((media.y + media.height - rect.y - rect.height) / media.height) * 100}%`,
    width: `${(rect.width / media.width) * 100}%`,
    height: `${(rect.height / media.height) * 100}%`,
  };
}

function moveBounds(
  start: PdfRect,
  dx: number,
  dy: number,
  media: PdfRect,
): PdfRect {
  return {
    ...start,
    x: clamp(start.x + dx, media.x, media.x + media.width - start.width),
    y: clamp(start.y - dy, media.y, media.y + media.height - start.height),
  };
}

function resizeBounds(
  start: PdfRect,
  dx: number,
  dy: number,
  media: PdfRect,
): PdfRect {
  const top = start.y + start.height;
  const right = clamp(
    start.x + start.width + dx,
    start.x + 20,
    media.x + media.width,
  );
  const bottom = clamp(start.y - dy, media.y, top - 20);
  return {
    x: start.x,
    y: bottom,
    width: right - start.x,
    height: top - bottom,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function downloadSingleLabel(label: {
  readonly outputOrder: number;
  readonly normalized?: { readonly pdfBytes: Uint8Array };
}): void {
  if (!label.normalized) return;
  const bytes = label.normalized.pdfBytes.slice();
  const url = URL.createObjectURL(
    new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `LABEL_${(label.outputOrder + 1).toString().padStart(2, "0")}.pdf`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function Datum({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
