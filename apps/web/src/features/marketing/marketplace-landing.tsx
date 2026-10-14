import Image from "next/image";
import Link from "next/link";
import { Logo } from "./logo";
import styles from "./marketplace-landing.module.css";

export type MarketplaceLandingContent = {
  marketplace: string;
  eyebrow: string;
  title: string;
  description: string;
  image: string;
  imageAlt: string;
  benefits: readonly string[];
  steps: readonly { title: string; description: string }[];
  questions: readonly { question: string; answer: string }[];
};

export function MarketplaceLanding({
  content,
}: {
  content: MarketplaceLandingContent;
}) {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: content.questions.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };

  return (
    <main className={styles.page}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replaceAll("<", "\\u003c"),
        }}
      />
      <header className={styles.header}>
        <Link href="/" aria-label="SellerLabel home">
          <Logo wordmark />
        </Link>
        <nav aria-label="Page navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#questions">Questions</a>
          <Link href="/login">Sign in</Link>
        </nav>
        <Link className={styles.headerCta} href="/register">
          START FREE ↗
        </Link>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <span>{content.eyebrow}</span>
          <h1>{content.title}</h1>
          <p>{content.description}</p>
          <div className={styles.actions}>
            <Link href="/register">Crop my labels free ↗</Link>
            <a href="#how-it-works">See how it works ↓</a>
          </div>
          <small>
            100 labels per day during early access · No card required
          </small>
        </div>
        <figure className={styles.comparison}>
          <Image
            src={content.image}
            alt={content.imageAlt}
            width={1448}
            height={1086}
            sizes="(max-width: 850px) 100vw, 52vw"
            priority
          />
          <figcaption>Demo data only.</figcaption>
        </figure>
      </section>

      <section className={styles.benefits} aria-label="Benefits">
        {content.benefits.map((benefit, index) => (
          <div key={benefit}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <p>{benefit}</p>
          </div>
        ))}
      </section>

      <section id="how-it-works" className={styles.workflow}>
        <div className={styles.sectionHeading}>
          <span>HOW IT WORKS</span>
          <h2>From marketplace PDF to a clean print run.</h2>
        </div>
        <div className={styles.stepGrid}>
          {content.steps.map((step, index) => (
            <article key={step.title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="questions" className={styles.faq}>
        <div className={styles.sectionHeading}>
          <span>{content.marketplace.toUpperCase()} QUESTIONS</span>
          <h2>What sellers usually ask.</h2>
        </div>
        <div className={styles.questionList}>
          {content.questions.map(({ question, answer }) => (
            <article key={question}>
              <h3>{question}</h3>
              <p>{answer}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.finalCta}>
        <span>READY FOR THE NEXT BATCH?</span>
        <h2>Keep the labels. Leave the invoice pages behind.</h2>
        <Link href="/register">CROP MY LABELS FREE ↗</Link>
      </section>

      <footer className={styles.footer}>
        <Link href="/">SellerLabel</Link>
        <a href="mailto:sellerlabels@gmail.com">sellerlabels@gmail.com</a>
        <span>100 × 150 mm · A4 four-up</span>
      </footer>
    </main>
  );
}
