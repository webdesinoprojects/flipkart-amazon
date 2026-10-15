"use client";

import {
  calculateProcessingProgress,
  projectStage,
  type Batch,
  type ProcessingStage,
} from "@label-normalizer/core";
import { ChevronDown } from "lucide-react";
import { ProgressBar, StatusBadge } from "@label-normalizer/ui";

const ACTIVE_STAGES: readonly {
  readonly id: ProcessingStage;
  readonly number: string;
  readonly label: string;
}[] = [
  { id: "ingest", number: "01", label: "INGEST" },
  { id: "parse", number: "02", label: "PARSE + PREVIEW" },
  { id: "classify", number: "03", label: "CLASSIFY" },
  { id: "extract", number: "04", label: "EXTRACT" },
  { id: "normalize", number: "05", label: "NORMALIZE" },
  { id: "validate", number: "06", label: "VALIDATE" },
  { id: "review", number: "07", label: "REVIEW" },
  { id: "assemble", number: "08", label: "ASSEMBLE" },
  { id: "complete", number: "09", label: "COMPLETE" },
];

const PROGRESS_STAGES: readonly ProcessingStage[] = [
  "ingest",
  "parse",
  "classify",
  "extract",
  "normalize",
  "assemble",
  "complete",
];

export function ProcessPanel({ batch }: { readonly batch: Batch }) {
  const overallProgress = calculateProcessingProgress(
    batch.events,
    PROGRESS_STAGES,
  );

  return (
    <section
      className="panel process-panel"
      aria-labelledby="live-process-title"
    >
      <div className="panel-heading">
        <div>
          <span className="eyebrow">LIVE PROCESS</span>
          <h2 id="live-process-title">LOCAL INSPECTION</h2>
        </div>
        <strong className="progress-number">{overallProgress}%</strong>
      </div>

      <ProgressBar
        className="overall-progress"
        label="Deterministic batch progress"
        value={overallProgress}
      />
      <p className="sr-only" aria-live="polite">
        Batch is {batch.status}. Deterministic processing is {overallProgress}%
        complete.
      </p>

      <div className="stage-list">
        {ACTIVE_STAGES.map((stage) => {
          const projection = projectStage(batch.events, stage.id);
          return (
            <details className="stage-row" key={stage.id}>
              <summary>
                <span className="stage-number">[{stage.number}]</span>
                <span className="stage-label">{stage.label}</span>
                <StatusBadge status={projection.status} />
                <ChevronDown
                  aria-hidden="true"
                  className="stage-expand-icon"
                  size={18}
                  strokeWidth={1.7}
                />
              </summary>
              <div className="stage-detail">
                <p>{projection.latestMessage}</p>
                <ol className="event-log">
                  {projection.events.map((event) => (
                    <li key={event.id}>
                      <time dateTime={event.timestamp}>
                        {new Date(event.timestamp).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </time>
                      <span>{event.message}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}
