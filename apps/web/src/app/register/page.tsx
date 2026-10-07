import Link from "next/link";
import { AuthForm } from "@/features/auth/auth-form";
import { AuthShell } from "@/features/auth/auth-shell";

export const metadata = {
  title: "Create account",
  robots: { index: false, follow: false },
};

export default function RegisterPage() {
  return (
    <AuthShell
      eyebrow="ACCOUNT / REGISTER"
      title="CREATE YOUR WORKSPACE."
      description="Start with a standard user account. Administrator access is assigned only by an operator."
      footer={
        <>
          ALREADY REGISTERED? <Link href="/login">SIGN IN</Link>
        </>
      }
    >
      <AuthForm mode="register" />
    </AuthShell>
  );
}
