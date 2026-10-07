import Link from "next/link";
import { BackgroundVideo } from "./background-video";
import { IllustrativeStats } from "./illustrative-stats";
import { MobileNavigation, ThemeToggle } from "./landing-controls";
import { Logo } from "./logo";
import { navigation } from "./navigation";
import { ProductSections } from "./product-sections";
import { PricingFooter } from "./pricing-footer";
import styles from "./marketing.module.css";
import navStyles from "./navigation.module.css";

export function LandingPage() {
  return (
    <div id="marketing-page" className={styles.page} data-theme="dark">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link
        rel="preconnect"
        href="https://fonts.gstatic.com"
        crossOrigin="anonymous"
      />
      {/* Fonts are scoped to the public page so the PDF workspace stays self-contained. */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap"
        rel="stylesheet"
      />
      <link
        href="https://db.onlinewebfonts.com/c/8cb707a9b8a73f8a7403336b861c3074?family=BubbledotICG-FinePos"
        rel="stylesheet"
      />
      <a className={styles.skipLink} href="#main">
        Skip to content
      </a>
      <header className={navStyles.header}>
        <Logo />
        <nav className={navStyles.desktopNav} aria-label="Main navigation">
          {navigation.map(([label, href]) => (
            <a href={href} key={href}>
              {label}
            </a>
          ))}
        </nav>
        <Link className={navStyles.headerCta} href="/app">
          START PROCESSING ↗
        </Link>
        <div className={navStyles.headerControls}>
          <ThemeToggle />
          <MobileNavigation />
        </div>
      </header>
      <main id="main">
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.videoBackground} aria-hidden="true">
            <BackgroundVideo />
          </div>
          <div className={styles.videoTint} aria-hidden="true" />
          <div className={styles.heroCenter}>
            <div
              className={styles.trustRow}
              aria-label="Supported marketplace PDF workflow"
            >
              <span className={styles.trustIcon} aria-hidden="true">
                <span className={styles.trustIconInner}>F</span>
              </span>
              <span className={styles.trustIcon} aria-hidden="true">
                <span className={styles.trustIconInner}>a</span>
              </span>
              <span className={styles.trustIcon} aria-hidden="true">
                <span className={styles.trustIconInner}>M</span>
              </span>
              <span className={styles.trustPill}>
                Flipkart · Amazon · Meesho
              </span>
            </div>
            <h1 id="hero-title" className={styles.headline}>
              <span>ONE BATCH.</span>
              <span>EVERY MARKETPLACE.</span>
              <span>PRINT READY.</span>
            </h1>
            <p className={styles.heroDescription}>
              Turn mixed Flipkart, Amazon and Meesho shipping PDFs into
              barcode-checked, print-ready 100 × 150 mm labels directly in the
              browser.
            </p>
            <div className={styles.heroActions}>
              <Link className={styles.primaryCta} href="/app">
                START PROCESSING ↗
              </Link>
              <a className={styles.secondaryCta} href="#workflow">
                SEE HOW IT WORKS ↓
              </a>
            </div>
          </div>
          <div>
            <IllustrativeStats />
            <p className={styles.sampleNote}>
              ILLUSTRATIVE BATCH · 1 REVIEW · 1 FAILED · NO CUSTOMER DOCUMENTS
            </p>
          </div>
        </section>
        <ProductSections />
        <PricingFooter />
      </main>
    </div>
  );
}
