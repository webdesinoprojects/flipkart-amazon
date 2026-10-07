import { redirect } from "next/navigation";
import { DashboardShell } from "@/features/auth/dashboard-shell";
import { adminAccess, currentUser } from "@/features/auth/server-api";
import styles from "@/features/auth/dashboard.module.css";
export const metadata = {
  title: "Administration",
  robots: { index: false, follow: false },
};
export default async function AdminPage() {
  const user = await currentUser();
  if (!user) redirect("/login?returnTo=%2Fadmin");
  if (!(await adminAccess())) redirect("/dashboard/labels");
  return (
    <DashboardShell user={user}>
      <section className={styles.panel}>
        <header className={styles.panelHead}>
          <div>
            <span className={styles.eyebrow}>OPERATOR / ADMIN</span>
            <h1>CONTROL PLANE.</h1>
          </div>
        </header>
        <div className={styles.adminGrid}>
          <article>
            <h2>AUTHORIZATION VERIFIED</h2>
            <p>
              The backend confirmed the admin role for this session. UI
              visibility is not the security boundary.
            </p>
          </article>
          <article>
            <h2>NEXT ADMIN PHASE</h2>
            <p>
              User summaries, credits, plans, payments, system health, and audit
              search remain intentionally unimplemented.
            </p>
          </article>
        </div>
      </section>
    </DashboardShell>
  );
}
