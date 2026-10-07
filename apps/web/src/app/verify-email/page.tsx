import { AuthShell } from "@/features/auth/auth-shell";
import { TokenForm } from "@/features/auth/token-form";

export const metadata = {
  title: "Verify email",
  robots: { index: false, follow: false },
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = "" } = await searchParams;
  return (
    <AuthShell
      eyebrow="ACCOUNT / VERIFICATION"
      title="VERIFY ADDRESS."
      description="Verification links are single-use and expire automatically."
    >
      <TokenForm mode="verify" token={token} />
    </AuthShell>
  );
}
