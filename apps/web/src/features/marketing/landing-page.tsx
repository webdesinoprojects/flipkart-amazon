import Link from "next/link";
import { Logo } from "./logo";
import { WorkflowPreview } from "./workflow-preview";
import { ProductSections } from "./product-sections";
import { PricingFooter } from "./pricing-footer";
import styles from "./marketing.module.css";

const navigation = [
  ["How It Works", "#workflow"],
  ["Marketplaces", "#marketplaces"],
  ["Features", "#features"],
  ["Pricing", "#pricing"],
  ["Privacy", "#privacy"],
] as const;

export function LandingPage() {
  return (
    <div className={styles.page}>
      <a className={styles.skipLink} href="#main">
        Skip to content
      </a>
      <header className={styles.header}>
        <div className={styles.headerRow}>
          <Logo />
          <nav className={styles.nav} aria-label="Main navigation">
            {navigation.map(([label, href]) => (
              <a href={href} key={href}>
                {label}
              </a>
            ))}
          </nav>
          <Link className={styles.headerCta} href="/app">
            START PROCESSING <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </header>
      <main id="main">
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroGrid} aria-hidden="true" />
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>
              <span className={styles.liveDot} /> LOCAL-FIRST MARKETPLACE LABEL
              PREPARATION
            </p>
            <h1 id="hero-title">
              ONE BATCH.
              <br />
              EVERY MARKETPLACE.
              <br />
              <span>PRINT READY.</span>
            </h1>
            <p className={styles.heroDescription}>
              Turn mixed Flipkart, Amazon and Meesho shipping PDFs into
              barcode-checked, print-ready 100 × 150 mm labels directly in the
              browser.
            </p>
            <div className={styles.heroActions}>
              <Link className={styles.buttonLight} href="/app">
                START PROCESSING <span aria-hidden="true">↗</span>
              </Link>
              <a className={styles.buttonOutline} href="#workflow">
                SEE HOW IT WORKS <span aria-hidden="true">↓</span>
              </a>
            </div>
          </div>
          <WorkflowPreview />
          <div className={styles.heroFoot}>
            <span>01 / LOCAL PROCESSING</span>
            <span>BUILT FOR 100 × 150 MM LABELS</span>
          </div>
        </section>
        <div
          className={styles.trustBar}
          aria-label="Supported marketplaces and workflow"
        >
          <span>WORKS WITH</span>
          <strong>FLIPKART</strong>
          <strong>AMAZON</strong>
          <strong>MEESHO</strong>
          <span>LOCAL-FIRST</span>
          <span>PDF-NATIVE</span>
        </div>
        <ProductSections />
        <PricingFooter />
      </main>
    </div>
  );
}
