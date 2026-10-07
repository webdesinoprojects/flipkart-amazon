import Link from "next/link";
import { AuthForm } from "@/features/auth/auth-form";
import { AuthShell } from "@/features/auth/auth-shell";

export const metadata = {
  title: "Recover account",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      eyebrow="ACCOUNT / RECOVERY"
      title="RESET ACCESS."
      description="Enter your email. The response stays identical whether an account exists or not."
      footer={<Link href="/login">← RETURN TO SIGN IN</Link>}
    >
      <AuthForm mode="forgot" />
    </AuthShell>
  );
}
