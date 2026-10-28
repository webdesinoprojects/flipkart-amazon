import "server-only";
import { serverRequest } from "@/features/api/server-request";
import type { AuthUser } from "./contracts";
import { resolveAdminAccess, resolveCurrentUser } from "./server-result";

export async function currentUser(): Promise<AuthUser | null> {
  const result = await serverRequest<{ user: AuthUser }>("/api/v1/auth/me");
  return resolveCurrentUser(result);
}

export async function adminAccess(): Promise<boolean> {
  const result = await serverRequest("/api/v1/admin/access-check");
  return resolveAdminAccess(result.status);
}
