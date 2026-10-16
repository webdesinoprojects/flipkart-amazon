import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AdminShell } from "@/features/admin/admin-shell";
import { adminAccess, currentUser } from "@/features/auth/server-api";

export const metadata = {
  title: "Administration",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  const user = await currentUser();
  if (!user) redirect("/login?returnTo=%2Fadmin");
  if (user.role !== "admin" || !(await adminAccess())) {
    redirect("/dashboard");
  }
  return <AdminShell user={user}>{children}</AdminShell>;
}
