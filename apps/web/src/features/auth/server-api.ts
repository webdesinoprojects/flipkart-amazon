import "server-only";
import { serverRequest } from "@/features/api/server-request";
import type { AuthUser } from "./contracts";

export async function currentUser(): Promise<AuthUser | null> {
  const result = await serverRequest<{ user: AuthUser }>("/api/v1/auth/me");
  return result.data?.user ?? null;
}

export async function adminAccess(): Promise<boolean> {
  return (await serverRequest("/api/v1/admin/access-check")).status === 200;
}
