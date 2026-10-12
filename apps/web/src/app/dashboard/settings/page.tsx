import { redirect } from "next/navigation";
import { currentUser } from "@/features/auth/server-api";
import { DashboardPage } from "@/features/dashboard/page-shell";
import styles from "@/features/dashboard/dashboard.module.css";

export const metadata = { title: "Account settings" };

export default async function AccountSettingsPage() {
  const user = await currentUser();
  if (!user) redirect("/login?returnTo=%2Fdashboard%2Fsettings");

  return (
    <DashboardPage
      eyebrow="ACCOUNT / SETTINGS"
      title="Your workspace identity."
      description="Review the account details currently enforced by the authentication service. Editable profile and notification preferences will be added only with backed persistence."
    >
      <div className={styles.routeGrid}>
        <article className={styles.card}>
          <h2>Identity</h2>
          <dl className={styles.detailList}>
            <Detail label="Email" value={user.email} />
            <Detail label="Role" value={user.role} />
            <Detail
              label="Verification"
              value={user.emailVerified ? "Verified" : "Pending"}
            />
          </dl>
        </article>
        <article className={styles.card}>
          <h2>Workspace</h2>
          <dl className={styles.detailList}>
            <Detail label="Type" value="Personal" />
            <Detail label="Processing" value="Browser-local first" />
            <Detail label="Output" value="100 × 150 mm portrait" />
          </dl>
        </article>
        <article className={styles.card}>
          <h2>Preferences</h2>
          <p>
            Theme preference is stored in this browser. Server-backed print and
            notification preferences are not implemented yet.
          </p>
        </article>
      </div>
    </DashboardPage>
  );
}

function Detail({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className={styles.detailRow}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
