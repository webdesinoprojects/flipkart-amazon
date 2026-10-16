import Link from "next/link";
import { Mail, ArrowUpRight } from "lucide-react";
import styles from "./dashboard.module.css";

const SUPPORT_EMAIL = "sellerlabels@gmail.com";

export function SupportContact({ billing = false }: { billing?: boolean }) {
  return (
    <section
      className={`${styles.card} ${styles.supportContact}`}
      id="contact-support"
    >
      <div>
        <span className={styles.pageEyebrow}>NEED A HAND?</span>
        <h2>Contact the SellerLabel team.</h2>
        <p>
          {billing
            ? "Questions about your plan, payment, or more daily credits? Email us from your account address so we can find your subscription."
            : "Need help with your account or workspace? Email us and we’ll help."}
        </p>
      </div>
      <div className={styles.supportContactActions}>
        <a
          className={styles.primaryAction}
          href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(billing ? "SellerLabel plan support" : "SellerLabel account support")}`}
        >
          <Mail aria-hidden="true" size={16} />
          EMAIL SUPPORT
        </a>
        <Link className={styles.secondaryAction} href="/contact">
          CONTACT DETAILS <ArrowUpRight aria-hidden="true" size={15} />
        </Link>
        <span className={styles.supportEmail}>{SUPPORT_EMAIL}</span>
      </div>
    </section>
  );
}
