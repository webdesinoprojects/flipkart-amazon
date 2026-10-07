"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./marketing.module.css";

const metrics = [
  { symbol: "<", value: 20, label: "PDF files" },
  { symbol: "#", value: 27, label: "Labels discovered" },
  { symbol: "*", value: 25, label: "Ready to print" },
  { symbol: "%", value: 2, label: "Need attention" },
] as const;

export function IllustrativeStats() {
  const container = useRef<HTMLDivElement>(null);
  const [values, setValues] = useState<number[]>(
    metrics.map((metric) => metric.value),
  );

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const element = container.current;
    if (!element) return;
    let frame = 0;
    let start = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        setValues(metrics.map(() => 0));
        const animate = (now: number) => {
          if (!start) start = now;
          const next = metrics.map((metric, index) => {
            const elapsed = Math.max(0, now - start - 480 - index * 90);
            const progress = Math.min(1, elapsed / (1500 + index * 80));
            return Math.round(metric.value * (1 - Math.pow(1 - progress, 3)));
          });
          setValues(next);
          if (next.some((value, index) => value < metrics[index]!.value)) {
            frame = requestAnimationFrame(animate);
          }
        };
        frame = requestAnimationFrame(animate);
      },
      { threshold: 0.25 },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      ref={container}
      className={styles.stats}
      aria-label="Illustrative batch statistics"
    >
      {metrics.map((metric, index) => (
        <div className={styles.stat} key={metric.label}>
          <span className={styles.statSymbol} aria-hidden="true">
            {metric.symbol}
          </span>
          <strong aria-label={`${metric.value} ${metric.label}`}>
            {values[index]}
          </strong>
          <span>{metric.label}</span>
        </div>
      ))}
    </div>
  );
}
