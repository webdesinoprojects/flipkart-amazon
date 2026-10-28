import type { AuthUser } from "./contracts";

export function resolveCurrentUser(result: {
  status: number;
  data: { user: AuthUser } | null;
}): AuthUser | null {
  if (result.status === 401) return null;
  if (result.status !== 200 || !result.data?.user) {
    throw new Error("Account service is temporarily unavailable.");
  }
  return result.data.user;
}

export function resolveAdminAccess(status: number): boolean {
  if (status === 200) return true;
  if (status === 401 || status === 403) return false;
  throw new Error("Admin access check is temporarily unavailable.");
}
