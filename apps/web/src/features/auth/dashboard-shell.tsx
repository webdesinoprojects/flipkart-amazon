"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Logo } from "@/features/marketing/logo";
import type { AuthUser } from "./contracts";
import { authApi } from "./browser-api";
import styles from "./dashboard.module.css";

export function DashboardShell({
  user,
  children,
}: {
  user: AuthUser;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await authApi.logout();
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Logo href="/dashboard/labels" wordmark />
        <nav aria-label="Account navigation">
          <Link
            data-active={pathname === "/dashboard/labels"}
            href="/dashboard/labels"
          >
            LABELS
          </Link>
          <Link
            data-active={pathname === "/dashboard/security"}
            href="/dashboard/security"
          >
            SECURITY
          </Link>
          {user.role === "admin" && (
            <Link data-active={pathname === "/admin"} href="/admin">
              ADMIN
            </Link>
          )}
        </nav>
        <div className={styles.account}>
          <span title={user.email}>{user.email}</span>
          <button onClick={signOut} disabled={signingOut}>
            {signingOut ? "…" : "SIGN OUT"}
          </button>
        </div>
      </header>
      <main className={styles.content}>{children}</main>
    </div>
  );
}
