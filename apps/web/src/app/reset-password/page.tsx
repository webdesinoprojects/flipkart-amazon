import { AuthShell } from "@/features/auth/auth-shell";
import { TokenForm } from "@/features/auth/token-form";

export const metadata = {
  title: "Set a new password",
  robots: { index: false, follow: false },
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = "" } = await searchParams;
  return (
    <AuthShell
      eyebrow="ACCOUNT / RECOVERY"
      title="NEW PASSWORD."
      description="A successful reset revokes every existing session on every device."
    >
      <TokenForm mode="reset" token={token} />
    </AuthShell>
  );
}
