"use client";

import { useEffect, useRef } from "react";
import styles from "./marketing.module.css";

const source =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260809_012548_ef22562c-c0ae-4816-ad9d-f8922af4e6a7.mp4";

export function BackgroundVideo() {
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      if (motion.matches) video.current?.pause();
      else void video.current?.play().catch(() => undefined);
    };
    update();
    motion.addEventListener("change", update);
    return () => motion.removeEventListener("change", update);
  }, []);

  return (
    <video
      ref={video}
      className={styles.bgVideo}
      autoPlay
      muted
      loop
      playsInline
      preload="metadata"
      aria-hidden="true"
      tabIndex={-1}
    >
      <source src={source} type="video/mp4" />
    </video>
  );
}
