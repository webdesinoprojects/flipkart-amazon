import styles from "./product.module.css";

const workflow = [
  {
    number: "01",
    title: "DROP THE BATCH",
    copy: "Add mixed marketplace PDFs at once. A PDF may hold more than one shipment, so the engine checks every page.",
  },
  {
    number: "02",
    title: "CHECK EACH LABEL",
    copy: "Pages are classified, cropped from the source PDF and validated. Uncertain results wait for your review.",
  },
  {
    number: "03",
    title: "PRINT TOGETHER",
    copy: "Preview, download or print one combined PDF with exactly 100 × 150 mm portrait pages.",
  },
];

const marketplaces = [
  {
    name: "FLIPKART",
    index: "01 / E-KART",
    copy: "Find the E-Kart shipping label and exclude the lower Tax Invoice.",
  },
  {
    name: "AMAZON",
    index: "02 / PAGE CLASSIFICATION",
    copy: "Retain shipping-label pages and exclude supplier or seller-only invoice pages.",
  },
  {
    name: "MEESHO",
    index: "03 / CONTENT BOUNDS",
    copy: "Detect meaningful label content, trim unnecessary whitespace and preserve package-label content.",
  },
  {
    name: "UNKNOWN",
    index: "04 / MANUAL REVIEW",
    copy: "Route uncertain layouts to manual review instead of silently approving them.",
  },
];

const features = [
  "Mixed Flipkart, Amazon and Meesho batches",
  "PDF count does not equal shipment count",
  "PDF-native crop and normalization",
  "Exactly 100 × 150 mm portrait output",
  "Barcode and QR validation",
  "Confidence-based review",
  "Manual crop and rotation",
  "Combined PRINT_READY_LABELS.pdf",
  "Preview, Download and Print All",
  "Browser-local deterministic processing",
  "Failed pages do not kill the whole batch",
];

export function ProductSections() {
  return (
    <>
      <section
        id="workflow"
        className={styles.section}
        aria-labelledby="workflow-heading"
      >
        <div className={styles.sectionIntro}>
          <span className={styles.kicker}>01 / THE WORKFLOW</span>
          <h2 id="workflow-heading">
            FROM MIXED PDFS
            <br />
            TO ONE CLEAN RUN.
          </h2>
          <p>
            Process the batch in a single flow, with a clear decision for each
            page.
          </p>
        </div>
        <div className={styles.workflowGrid}>
          {workflow.map((step) => (
            <article className={styles.workflowCard} key={step.number}>
              <span className={styles.cardNumber}>{step.number} / 03</span>
              <div className={styles.workflowGlyph} aria-hidden="true">
                {step.number === "01" ? "⊞" : step.number === "02" ? "⌗" : "▤"}
              </div>
              <h3>{step.title}</h3>
              <p>{step.copy}</p>
            </article>
          ))}
        </div>
      </section>
      <section
        id="marketplaces"
        className={styles.marketSection}
        aria-labelledby="marketplaces-heading"
      >
        <div className={styles.sectionIntro}>
          <span className={styles.kicker}>02 / MARKETPLACE INTELLIGENCE</span>
          <h2 id="marketplaces-heading">
            ONE WORKFLOW.
            <br />
            DIFFERENT RULES.
          </h2>
          <p>
            Each marketplace has its own document shape. The app handles what
            belongs on the package.
          </p>
        </div>
        <div className={styles.marketGrid}>
          {marketplaces.map((marketplace) => (
            <article className={styles.marketCard} key={marketplace.name}>
              <span className={styles.cardNumber}>{marketplace.index}</span>
              <h3>
                {marketplace.name}
                <span aria-hidden="true">↗</span>
              </h3>
              <p>{marketplace.copy}</p>
            </article>
          ))}
        </div>
      </section>
      <section
        id="features"
        className={styles.section}
        aria-labelledby="features-heading"
      >
        <div className={styles.featuresLayout}>
          <div className={styles.sectionIntro}>
            <span className={styles.kicker}>03 / BUILT INTO THE APP</span>
            <h2 id="features-heading">
              THE DETAILS
              <br />
              MATTER.
            </h2>
            <p>
              Practical controls for a label you can actually print and scan.
            </p>
          </div>
          <ul className={styles.featureList}>
            {features.map((feature, index) => (
              <li key={feature}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                {feature}
                <span aria-hidden="true">↗</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
