import Link from "next/link";
import { plans } from "@/features/plans/catalog";
import { Logo } from "./logo";
import styles from "./pricing.module.css";

export function PricingFooter() {
  return (
    <>
      <section
        id="pricing"
        className={styles.pricingSection}
        aria-labelledby="pricing-heading"
      >
        <div className={styles.sectionIntro}>
          <span className={styles.kicker}>05 / SIMPLE DAILY CREDITS</span>
          <h2 id="pricing-heading">
            START FREE.
            <br />
            GROW WHEN READY.
          </h2>
          <p>
            Start with 100 free daily credits. Paid plans renew monthly until
            cancelled and add more daily credits. One print-ready label uses one
            credit.
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
                  {String(index + 1).padStart(2, "0")} /{" "}
                  {plan.name.toUpperCase()}
                </span>
                {plan.available && <span>AVAILABLE NOW</span>}
              </div>
              <p className={styles.planPrice}>
                ₹{plan.monthlyPriceInr}
                <span>{plan.available ? " / early access" : " / month"}</span>
              </p>
              <p className={styles.planDescription}>{plan.description}</p>
              <div className={styles.planLimit}>
                <span>DAILY ALLOWANCE</span>
                <strong>
                  {plan.dailyCredits.toLocaleString("en-IN")} labels per day
                </strong>
              </div>
              <Link
                className={styles.planButton}
                href={
                  plan.code === "free" ? "/register" : "/dashboard/subscription"
                }
              >
                {plan.code === "free" ? "START FREE" : "VIEW PLAN"}{" "}
                <span aria-hidden="true">↗</span>
              </Link>
            </article>
          ))}
        </div>
        <div className={styles.businessPlan}>
          <div>
            <span className={styles.kicker}>BUSINESS / CUSTOM VOLUME</span>
            <h3>More pages or a team workflow?</h3>
            <p>Talk to us about a custom allowance and onboarding support.</p>
          </div>
          <a href="mailto:sellerlabels@gmail.com?subject=SellerLabel%20Business%20Plan">
            CONTACT SELLERLABEL <span aria-hidden="true">↗</span>
          </a>
        </div>
      </section>
      <section
        id="privacy"
        className={styles.privacySection}
        aria-labelledby="privacy-heading"
      >
        <div>
          <span className={styles.kicker}>06 / PRIVATE BY DEFAULT</span>
          <h2 id="privacy-heading">
            YOUR DOCUMENTS.
            <br />
            YOUR CONTROL.
          </h2>
        </div>
        <div className={styles.privacyCopy}>
          <p>
            Your original marketplace PDFs are processed in your browser and are
            not uploaded for label detection or cropping.
          </p>
          <p>
            A finished PDF is saved to your private history only when the app
            prepares it for your account.
          </p>
        </div>
      </section>
      <section className={styles.finalCta} aria-labelledby="final-cta-heading">
        <span className={styles.kicker}>READY WHEN YOU ARE</span>
        <h2 id="final-cta-heading">
          MAKE THE NEXT
          <br />
          BATCH PRINT READY.
        </h2>
        <Link className={styles.buttonLight} href="/register">
          CROP MY LABELS FREE <span aria-hidden="true">↗</span>
        </Link>
      </section>
      <footer className={styles.footer}>
        <div className={styles.footerTop}>
          <div>
            <Logo wordmark />
            <p>Marketplace shipping labels, prepared for the printer.</p>
            <a
              className={styles.supportEmail}
              href="mailto:sellerlabels@gmail.com"
            >
              sellerlabels@gmail.com
            </a>
          </div>
          <nav aria-label="Footer navigation">
            <a href="#workflow">How It Works</a>
            <a href="#marketplaces">Marketplaces</a>
            <a href="#features">Features</a>
            <a href="#faq">FAQ</a>
            <a href="#pricing">Pricing</a>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/refund-policy">Refunds</Link>
            <Link href="/contact">Contact</Link>
            <Link href="/login">Sign in</Link>
          </nav>
        </div>
        <div className={styles.footerBottom}>
          <span>© {new Date().getFullYear()} SELLERLABEL</span>
          <span>100 × 150 MM / A4 FOUR-UP / PRIVATE HISTORY</span>
        </div>
      </footer>
    </>
  );
}
