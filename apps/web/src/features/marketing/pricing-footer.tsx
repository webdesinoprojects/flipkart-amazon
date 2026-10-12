import Link from "next/link";
import { Logo } from "./logo";
import styles from "./pricing.module.css";

const plans = [
  {
    name: "STARTER",
    price: "₹99",
    limit: "100 successful labels/day",
    description: "For occasional label batches.",
  },
  {
    name: "GROWTH",
    price: "₹199",
    limit: "400 successful labels/day",
    description: "For a steady daily shipping flow.",
  },
  {
    name: "BUSINESS",
    price: "₹299",
    limit: "800 successful labels/day",
    description: "For larger daily batches.",
  },
];

export function PricingFooter() {
  return (
    <>
      <section
        id="pricing"
        className={styles.pricingSection}
        aria-labelledby="pricing-heading"
      >
        <div className={styles.sectionIntro}>
          <span className={styles.kicker}>04 / PLANNED LAUNCH PRICING</span>
          <h2 id="pricing-heading">
            A PLAN FOR
            <br />
            EACH PACE.
          </h2>
          <p>
            Accounts and private output history are active. Billing and plan
            limits are not enabled yet.
          </p>
        </div>
        <div className={styles.pricingGrid}>
          {plans.map((plan, index) => (
            <article
              className={index === 1 ? styles.planFeatured : styles.plan}
              key={plan.name}
            >
              <div className={styles.planTop}>
                <span>
                  0{index + 1} / {plan.name}
                </span>
                {index === 1 && <span>PLANNED</span>}
              </div>
              <p className={styles.planPrice}>
                {plan.price}
                <span>/month</span>
              </p>
              <p className={styles.planDescription}>{plan.description}</p>
              <div className={styles.planLimit}>
                <span>DAILY CAPACITY</span>
                <strong>{plan.limit}</strong>
              </div>
              <Link className={styles.planButton} href="/register">
                TRY THE LOCAL APP <span aria-hidden="true">↗</span>
              </Link>
            </article>
          ))}
        </div>
      </section>
      <section
        id="privacy"
        className={styles.privacySection}
        aria-labelledby="privacy-heading"
      >
        <div>
          <span className={styles.kicker}>05 / PRIVATE BY DEFAULT</span>
          <h2 id="privacy-heading">
            YOUR DOCUMENTS.
            <br />
            YOUR BROWSER.
          </h2>
        </div>
        <div className={styles.privacyCopy}>
          <p>
            Original marketplace PDFs stay in the browser during the normal
            local workflow. Processing does not require OpenAI, Gemini, ImageKit
            or Neon.
          </p>
          <p>No real customer documents are used as landing-page assets.</p>
        </div>
      </section>
      <section className={styles.finalCta} aria-labelledby="final-cta-heading">
        <span className={styles.kicker}>READY WHEN YOU ARE</span>
        <h2 id="final-cta-heading">
          MAKE THE NEXT
          <br />
          BATCH PRINT READY.
        </h2>
        <Link className={styles.buttonLight} href="/login">
          OPEN THE LOCAL APP <span aria-hidden="true">↗</span>
        </Link>
      </section>
      <footer className={styles.footer}>
        <div className={styles.footerTop}>
          <div>
            <Logo wordmark />
            <p>Marketplace shipping labels, prepared for the printer.</p>
          </div>
          <nav aria-label="Footer navigation">
            <a href="#workflow">How It Works</a>
            <a href="#marketplaces">Marketplaces</a>
            <a href="#features">Features</a>
            <a href="#pricing">Pricing</a>
            <a href="#privacy">Privacy</a>
            <Link href="/login">Open App</Link>
          </nav>
        </div>
        <div className={styles.footerBottom}>
          <span>© {new Date().getFullYear()} LABEL NORMALIZER</span>
          <span>LOCAL-FIRST / PDF-NATIVE / 100 × 150 MM</span>
        </div>
      </footer>
    </>
  );
}
