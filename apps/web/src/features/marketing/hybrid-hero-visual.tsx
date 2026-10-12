"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./hero-visual.module.css";

type PlaybackState = "idle" | "running" | "done";

export function HybridHeroVisual() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playbackState, setPlaybackState] = useState<PlaybackState>("idle");

  const showFinalState = useCallback(() => {
    setPlaybackState("done");
  }, []);

  const playFromStart = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    setPlaybackState("idle");
    void video.play().catch(showFinalState);
  }, [showFinalState]);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotionPreference = () => {
      if (motion.matches) showFinalState();
      else playFromStart();
    };
    updateMotionPreference();
    motion.addEventListener("change", updateMotionPreference);
    return () => motion.removeEventListener("change", updateMotionPreference);
  }, [playFromStart, showFinalState]);

  return (
    <div
      className={styles.visual}
      data-state={playbackState}
      role="img"
      aria-label="A marketplace PDF enters a precision machine and becomes a clean 100 by 150 millimetre shipping label."
    >
      <video
        ref={videoRef}
        className={styles.video}
        muted
        playsInline
        preload="metadata"
        poster="/images/marketing/label-machine-poster.webp"
        onEnded={() => setPlaybackState("done")}
        onPlaying={() => setPlaybackState("running")}
        tabIndex={-1}
        aria-hidden="true"
      >
        <source src="/video/label-machine-hero.webm" type="video/webm" />
        <source src="/video/label-machine-hero.mp4" type="video/mp4" />
      </video>

      <div className={styles.frameWash} aria-hidden="true" />
      <div className={styles.sequenceLabel} aria-hidden="true">
        <span>Live transformation</span>
        <strong>PDF → LABEL</strong>
      </div>

      <div className={styles.sourceDocument} aria-hidden="true">
        <span className={styles.documentTag}>Original marketplace PDF</span>
        <div className={styles.documentSurface}>
          <Image
            src="/images/marketing/flipkart-original.webp"
            alt=""
            width={590}
            height={895}
            priority
            sizes="(max-width: 820px) 34vw, 240px"
          />
          <span className={styles.cropFrame} />
          <span className={styles.scanLine} />
        </div>
      </div>

      <div className={styles.outputLabel} aria-hidden="true">
        <div className={styles.outputTopline}>
          <span>Ready to print</span>
          <strong>100 × 150 mm</strong>
        </div>
        <Image
          src="/images/marketing/flipkart-label.webp"
          alt=""
          width={537}
          height={847}
          priority
          sizes="(max-width: 820px) 40vw, 280px"
        />
        <div className={styles.outputActions}>
          <span>PDF checked</span>
          <span>Download PDF ↗</span>
        </div>
      </div>

      <div className={styles.progress} aria-hidden="true">
        <span>Detect</span>
        <span>Crop</span>
        <span>Check</span>
        <span>Ready</span>
      </div>

      <button
        className={styles.replay}
        type="button"
        onClick={playFromStart}
        aria-label="Replay label transformation"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 7v5h-5M19 12a7 7 0 1 0-2.05 4.95" />
        </svg>
        Replay
      </button>
    </div>
  );
}
