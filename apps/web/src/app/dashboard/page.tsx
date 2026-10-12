import { redirect } from "next/navigation";
import { currentUser } from "@/features/auth/server-api";
import { DashboardOverview } from "@/features/dashboard/overview";
import { dashboardSummary } from "@/features/dashboard/server-api";

export const metadata = { title: "Dashboard overview" };

export default async function DashboardPage() {
  const user = await currentUser();
  if (!user) redirect("/login?returnTo=%2Fdashboard");
  const summary = await dashboardSummary();
  return <DashboardOverview summary={summary} user={user} />;
}
