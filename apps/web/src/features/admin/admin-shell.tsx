"use client";

import {
  Activity,
  ArrowLeft,
  CreditCard,
  LayoutDashboard,
  Menu,
  ScanLine,
  ScrollText,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { AuthUser } from "@/features/auth/contracts";
import styles from "./admin.module.css";

const navigation = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/customers", label: "Customers", icon: UsersRound },
  { href: "/admin/payments", label: "Payments", icon: CreditCard },
  { href: "/admin/operations", label: "Operations", icon: Activity },
  { href: "/admin/audit", label: "Audit trail", icon: ScrollText },
] as const;

export function AdminShell({
  user,
  children,
}: {
  readonly user: AuthUser;
  readonly children: ReactNode;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const section =
    navigation.find((item) =>
      item.href === "/admin"
        ? pathname === item.href
        : pathname.startsWith(item.href),
    )?.label ?? "Administration";

  return (
    <div className={styles.canvas}>
      <div className={styles.ambientOne} aria-hidden="true" />
      <div className={styles.ambientTwo} aria-hidden="true" />
      <div className={styles.frame}>
        {menuOpen && (
          <button
            aria-label="Close admin navigation"
            className={styles.mobileScrim}
            onClick={() => setMenuOpen(false)}
            type="button"
          />
        )}
        <aside
          aria-label="Admin navigation"
          className={`${styles.sidebar} ${menuOpen ? styles.sidebarOpen : ""}`}
        >
          <Link
            className={styles.brand}
            href="/admin"
            onClick={() => setMenuOpen(false)}
          >
            <span className={styles.brandMark}>
              <ScanLine aria-hidden="true" size={20} strokeWidth={1.8} />
            </span>
            <span>
              <strong>SellerLabel</strong>
              <small>CONTROL ROOM</small>
            </span>
          </Link>

          <div className={styles.sidebarGroup}>
            <span className={styles.sidebarCaption}>WORKSPACE</span>
            <nav aria-label="Admin pages" className={styles.nav}>
              {navigation.map((item) => {
                const Icon = item.icon;
                const active =
                  item.href === "/admin"
                    ? pathname === item.href
                    : pathname.startsWith(item.href);
                return (
                  <Link
                    aria-current={active ? "page" : undefined}
                    className={`${styles.navLink} ${active ? styles.navActive : ""}`}
                    href={item.href}
                    key={item.href}
                    onClick={() => setMenuOpen(false)}
                  >
                    <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className={styles.sidebarBottom}>
            <div className={styles.permissionNote}>
              <span className={styles.permissionDot} />
              <span>
                <strong>Admin session</strong>
                <small>Protected by your account</small>
              </span>
            </div>
            <Link className={styles.backLink} href="/dashboard">
              <ArrowLeft aria-hidden="true" size={16} /> Seller workspace
            </Link>
          </div>
        </aside>

        <div className={styles.mainArea}>
          <header className={styles.topbar}>
            <div className={styles.topbarStart}>
              <button
                aria-label="Open admin navigation"
                className={styles.menuButton}
                onClick={() => setMenuOpen(true)}
                type="button"
              >
                <Menu aria-hidden="true" size={21} />
              </button>
              <span className={styles.breadcrumb}>
                ADMIN / {section.toUpperCase()}
              </span>
            </div>
            <div className={styles.topbarEnd}>
              <span className={styles.accessBadge}>
                <span /> SECURE VIEW
              </span>
              <span className={styles.accountChip} title={user.email}>
                <span className={styles.accountAvatar}>
                  {user.email.slice(0, 1).toUpperCase()}
                </span>
                <span className={styles.accountEmail}>{user.email}</span>
              </span>
            </div>
          </header>
          <main className={styles.content}>{children}</main>
        </div>
      </div>
    </div>
  );
}
