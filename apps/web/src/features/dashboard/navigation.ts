import type { LucideIcon } from "lucide-react";
import {
  BadgeIndianRupee,
  CreditCard,
  FileClock,
  Gauge,
  Settings,
  ShieldCheck,
  Tags,
  UsersRound,
} from "lucide-react";

export interface DashboardNavigationItem {
  readonly href: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly icon: LucideIcon;
  readonly adminOnly?: boolean;
}

export const primaryNavigation: readonly DashboardNavigationItem[] = [
  {
    href: "/dashboard",
    label: "Overview",
    shortLabel: "Overview",
    icon: Gauge,
  },
  {
    href: "/dashboard/labels",
    label: "Label workspace",
    shortLabel: "Workspace",
    icon: Tags,
  },
  {
    href: "/dashboard/history",
    label: "Batch history",
    shortLabel: "History",
    icon: FileClock,
  },
  {
    href: "/dashboard/credits",
    label: "Credits & usage",
    shortLabel: "Credits",
    icon: BadgeIndianRupee,
  },
  {
    href: "/dashboard/subscription",
    label: "Subscription",
    shortLabel: "Plans",
    icon: CreditCard,
  },
];

export const accountNavigation: readonly DashboardNavigationItem[] = [
  {
    href: "/dashboard/settings",
    label: "Account settings",
    shortLabel: "Settings",
    icon: Settings,
  },
  {
    href: "/dashboard/security",
    label: "Security & sessions",
    shortLabel: "Security",
    icon: ShieldCheck,
  },
  {
    href: "/admin",
    label: "Administration",
    shortLabel: "Admin",
    icon: UsersRound,
    adminOnly: true,
  },
];

export function isNavigationItemActive(
  pathname: string,
  item: DashboardNavigationItem,
): boolean {
  if (item.href === "/dashboard") return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function currentNavigationLabel(pathname: string): string {
  return (
    [...primaryNavigation, ...accountNavigation].find((item) =>
      isNavigationItemActive(pathname, item),
    )?.label ?? "Dashboard"
  );
}
