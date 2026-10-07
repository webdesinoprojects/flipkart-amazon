import styles from "./marketing.module.css";

const stages = [
  "INGEST",
  "PARSE",
  "CLASSIFY",
  "EXTRACT",
  "NORMALIZE",
  "VALIDATE",
  "REVIEW",
  "ASSEMBLE",
  "COMPLETE",
];
const results = [
  ["27", "LABELS DISCOVERED"],
  ["25", "READY"],
  ["01", "REVIEW"],
  ["01", "FAILED"],
] as const;

export function WorkflowPreview() {
  return (
    <div
      className={styles.preview}
      aria-label="Illustrative batch processing preview"
    >
      <div className={styles.previewTop}>
        <span>
          <span className={styles.previewPulse} /> BATCH / PREVIEW
        </span>
        <span>LOCAL ENGINE · 01</span>
      </div>
      <div className={styles.previewTitle}>
        <span>20 PDF FILES</span>
        <span>→</span>
        <span>PRINT_READY_LABELS.pdf</span>
      </div>
      <div className={styles.previewMetrics}>
        {results.map(([number, label]) => (
          <div className={styles.metric} key={label}>
            <strong>{number}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className={styles.previewProcess}>
        <div className={styles.previewLabel}>
          <span>PROCESSING PIPELINE</span>
          <span>09 STAGES</span>
        </div>
        <ol className={styles.stageList}>
          {stages.map((stage, index) => (
            <li key={stage}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              {stage}
              <span className={styles.stageCheck}>✓</span>
            </li>
          ))}
        </ol>
      </div>
      <p className={styles.previewNote}>
        ILLUSTRATIVE PREVIEW · NO CUSTOMER DOCUMENTS
      </p>
    </div>
  );
}
