"use client";

import Image from "next/image";
import { useId, useState } from "react";
import styles from "./comparison.module.css";

const examples = [
  {
    name: "Flipkart",
    detail: "Keeps the E-Kart shipping label and removes the tax invoice.",
    image: "/images/marketing/flipkart-comparison.webp",
  },
  {
    name: "Amazon",
    detail: "Separates the package label from the supplier invoice pages.",
    image: "/images/marketing/amazon-comparison.webp",
  },
  {
    name: "Meesho",
    detail:
      "Trims excess page space while preserving the complete courier label.",
    image: "/images/marketing/meesho-comparison.webp",
  },
] as const;

export function MarketplaceComparison() {
  const [selected, setSelected] = useState(0);
  const tabsId = useId();
  const example = examples[selected] ?? examples[0];

  function selectWithKeyboard(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    setSelected(
      (current) => (current + direction + examples.length) % examples.length,
    );
  }

  return (
    <section
      id="comparison"
      className={styles.section}
      aria-labelledby="comparison-heading"
    >
      <div className={styles.intro}>
        <span className={styles.kicker}>BEFORE / AFTER</span>
        <div>
          <h2 id="comparison-heading">See exactly what stays.</h2>
          <p>
            The shipping label is kept at print-ready size. Invoices and unused
            page space are removed before the final PDF is created.
          </p>
        </div>
      </div>

      <div className={styles.viewer}>
        <div className={styles.toolbar}>
          <div
            className={styles.tabs}
            role="tablist"
            aria-label="Marketplace example"
          >
            {examples.map((item, index) => (
              <button
                id={`${tabsId}-tab-${index}`}
                className={styles.tab}
                type="button"
                role="tab"
                aria-selected={selected === index}
                aria-controls={`${tabsId}-panel`}
                tabIndex={selected === index ? 0 : -1}
                key={item.name}
                onClick={() => setSelected(index)}
                onKeyDown={selectWithKeyboard}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                {item.name}
              </button>
            ))}
          </div>
          <p className={styles.exampleDetail}>{example.detail}</p>
        </div>

        <div
          id={`${tabsId}-panel`}
          className={styles.panel}
          role="tabpanel"
          aria-labelledby={`${tabsId}-tab-${selected}`}
          key={example.name}
        >
          <div className={styles.legend} aria-hidden="true">
            <span>Original marketplace PDF</span>
            <span>Print-ready label</span>
          </div>
          <figure className={styles.figure}>
            <Image
              src={example.image}
              alt={`${example.name} original PDF beside its extracted print-ready shipping label`}
              width={1448}
              height={1086}
              sizes="(max-width: 760px) 100vw, 90vw"
            />
            <figcaption>
              Demo data only. Names, addresses, order IDs and codes shown in
              these samples are synthetic.
            </figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}
