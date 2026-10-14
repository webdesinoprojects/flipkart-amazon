import { absoluteUrl } from "@/lib/site";
import styles from "./seller-faq.module.css";

const questions = [
  {
    question: "Does SellerLabel work on mobile?",
    answer:
      "You can open the dashboard on a phone, but reviewing a large batch and printing PDFs is easier on a laptop or desktop.",
  },
  {
    question: "Do my customer PDFs get uploaded?",
    answer:
      "Your original marketplace PDFs are processed in your browser. Only a finished output you keep in private history is saved to your account.",
  },
  {
    question: "Which thermal printers are supported?",
    answer:
      "SellerLabel creates a standard 100 × 150 mm PDF. It works with printers and drivers that accept that page size; always preview one label before printing a full batch.",
  },
  {
    question: "Can I print on A4 paper?",
    answer:
      "Yes. Choose A4 four-up to place four labels on each A4 sheet, or keep one 100 × 150 mm label per page for a thermal printer.",
  },
  {
    question: "What happens when one page cannot be recognised?",
    answer:
      "SellerLabel marks uncertain pages for review. One unusual page does not stop the rest of the batch from being prepared.",
  },
  {
    question: "How do daily credits work?",
    answer:
      "One successfully prepared shipping label uses one credit. Early-access accounts receive 100 daily credits; paid plans will add larger allowances when billing launches.",
  },
] as const;

export function SellerFaq() {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    url: absoluteUrl("/#faq"),
    mainEntity: questions.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };

  return (
    <section id="faq" className={styles.section} aria-labelledby="faq-heading">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replaceAll("<", "\\u003c"),
        }}
      />
      <div className={styles.intro}>
        <span className={styles.kicker}>04 / COMMON QUESTIONS</span>
        <h2 id="faq-heading">
          BEFORE YOUR
          <br />
          FIRST BATCH.
        </h2>
        <p>Clear answers for sellers setting up their label workflow.</p>
      </div>
      <div className={styles.questions}>
        {questions.map(({ question, answer }, index) => (
          <article className={styles.question} key={question}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div>
              <h3>{question}</h3>
              <p>{answer}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
