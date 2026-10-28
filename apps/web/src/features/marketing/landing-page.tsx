import Link from "next/link";
import { HybridHeroVisual } from "./hybrid-hero-visual";
import { MobileNavigation, ThemeToggle } from "./landing-controls";
import { Logo } from "./logo";
import { MarketplaceComparison } from "./marketplace-comparison";
import { navigation, WORKSPACE_ENTRY } from "./navigation";
import { ProductSections } from "./product-sections";
import { PricingFooter } from "./pricing-footer";
import { SellerFaq } from "./seller-faq";
import styles from "./marketing.module.css";
import navStyles from "./navigation.module.css";

const proofPoints = [
  ["3 marketplaces", "Flipkart, Amazon and Meesho"],
  ["2 print layouts", "100 × 150 mm or A4 four-up"],
  ["1 clean PDF", "Preview, download and print"],
] as const;

export function LandingPage() {
  return (
    <div id="marketing-page" className={styles.page} data-theme="light">
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
        <Link className={navStyles.headerCta} href={WORKSPACE_ENTRY}>
          START PROCESSING ↗
        </Link>
        <div className={navStyles.headerControls}>
          <ThemeToggle />
          <MobileNavigation />
        </div>
      </header>
      <main id="main">
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroGrid}>
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}>
                <span aria-hidden="true" />
                Built for marketplace sellers
              </p>
              <h1 id="hero-title" className={styles.headline}>
                Shipping labels in.
                <span>Print-ready PDFs out.</span>
              </h1>
              <p className={styles.heroDescription}>
                Remove invoices, crop every shipping label correctly and prepare
                a complete Flipkart, Amazon or Meesho batch for printing.
              </p>
              <div className={styles.heroActions}>
                <Link className={styles.primaryCta} href={WORKSPACE_ENTRY}>
                  Crop my labels free <span aria-hidden="true">↗</span>
                </Link>
                <a className={styles.secondaryCta} href="#comparison">
                  See before and after <span aria-hidden="true">↓</span>
                </a>
              </div>
              <p className={styles.heroAssurance}>
                No card required <span aria-hidden="true">·</span> Review before
                printing <span aria-hidden="true">·</span> Original PDFs stay in
                your browser
              </p>
            </div>
            <HybridHeroVisual />
          </div>
          <div className={styles.proofStrip} aria-label="Product capabilities">
            {proofPoints.map(([value, label], index) => (
              <div className={styles.proofItem} key={value}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{value}</strong>
                <small>{label}</small>
              </div>
            ))}
          </div>
        </section>
        <MarketplaceComparison />
        <ProductSections />
        <SellerFaq />
        <PricingFooter />
      </main>
    </div>
  );
}
