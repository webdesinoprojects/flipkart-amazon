import { AuthShell } from "@/features/auth/auth-shell";
import { TokenForm } from "@/features/auth/token-form";

export const metadata = {
  title: "Verify email",
  robots: { index: false, follow: false },
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; email?: string }>;
}) {
  const { token = "", email = "" } = await searchParams;
  return (
    <AuthShell
      eyebrow="ACCOUNT / VERIFICATION"
      title="VERIFY ADDRESS."
      description="Enter the six-digit code from your email. You can use it here even if you opened the message on another device."
    >
      <TokenForm mode="verify" token={token} email={email} />
    </AuthShell>
  );
}
