import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/features/auth/auth-form";
import { AuthShell } from "@/features/auth/auth-shell";
import { safeReturnTarget } from "@/features/auth/return-target";
import { currentUser } from "@/features/auth/server-api";

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
  if (await currentUser()) redirect(safeReturnTarget(returnTo));
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
