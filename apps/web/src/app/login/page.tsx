import Link from "next/link";
import { AuthForm } from "@/features/auth/auth-form";
import { AuthShell } from "@/features/auth/auth-shell";

export const metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { returnTo } = await searchParams;
  return (
    <AuthShell
      eyebrow="ACCOUNT / SIGN IN"
      title="WELCOME BACK."
      description="Sign in to your private label-processing workspace."
      footer={
        <>
          NEW HERE? <Link href="/register">CREATE AN ACCOUNT</Link>
        </>
      }
    >
      <AuthForm mode="login" returnTo={returnTo} />
    </AuthShell>
  );
}
