import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { DashboardShell } from "@/features/dashboard/dashboard-shell";
import { currentUser } from "@/features/auth/server-api";

export const metadata = { robots: { index: false, follow: false } };
export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await currentUser();
  if (!user) redirect("/login?returnTo=%2Fdashboard");
  return <DashboardShell user={user}>{children}</DashboardShell>;
}
