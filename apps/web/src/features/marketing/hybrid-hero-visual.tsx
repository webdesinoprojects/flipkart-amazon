import Image from "next/image";
import styles from "./hero-visual.module.css";

export function HybridHeroVisual() {
  return (
    <div
      className={styles.visual}
      role="img"
      aria-label="A marketplace PDF is transformed into a clean shipping label ready for a thermal printer"
    >
      <video
        className={styles.printerVideo}
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        poster="/images/marketing/label-machine-poster.webp"
        aria-hidden="true"
      >
        <source src="/video/label-machine-hero.webm" type="video/webm" />
        <source src="/video/label-machine-hero.mp4" type="video/mp4" />
      </video>

      <div className={styles.sourceSheet} aria-hidden="true">
        <Image
          src="/images/marketing/flipkart-original.webp"
          alt=""
          width={720}
          height={1018}
          sizes="(max-width: 880px) 34vw, 18vw"
          priority
        />
      </div>

      <div className={styles.outputSheet} aria-hidden="true">
        <Image
          src="/images/marketing/flipkart-label.webp"
          alt=""
          width={720}
          height={1018}
          sizes="(max-width: 880px) 36vw, 20vw"
          priority
        />
      </div>
    </div>
  );
}
