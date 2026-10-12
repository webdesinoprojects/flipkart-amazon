"use client";

import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { useEffect, useState } from "react";
import { navigation } from "./navigation";
import styles from "./navigation.module.css";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.getElementById("marketing-page")?.setAttribute("data-theme", next);
  }

  return (
    <button
      className={styles.themeButton}
      type="button"
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      onClick={toggleTheme}
    >
      <span aria-hidden="true">{theme === "dark" ? "☼" : "◐"}</span>
    </button>
  );
}

export function MobileNavigation() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 721px)");
    const closeOnDesktop = () => {
      if (query.matches) setOpen(false);
    };
    query.addEventListener("change", closeOnDesktop);
    return () => query.removeEventListener("change", closeOnDesktop);
  }, []);

  return (
    <div className={styles.mobileMenu}>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger className={styles.burger} aria-label="Open menu">
          <span className={styles.burgerBars} aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.overlay} />
          <Dialog.Content
            className={styles.menuSheet}
            aria-describedby={undefined}
          >
            <div className={styles.menuTop}>
              <Dialog.Title>MENU</Dialog.Title>
              <Dialog.Close
                className={styles.menuClose}
                aria-label="Close menu"
              >
                ×
              </Dialog.Close>
            </div>
            <nav className={styles.mobileNav} aria-label="Mobile navigation">
              {navigation.map(([label, href]) => (
                <Dialog.Close asChild key={href}>
                  <a href={href}>{label}</a>
                </Dialog.Close>
              ))}
            </nav>
            <Dialog.Close asChild>
              <Link className={styles.mobileCta} href="/register">
                START PROCESSING ↗
              </Link>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
