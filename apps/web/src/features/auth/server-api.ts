import "server-only";
import { cookies } from "next/headers";
import type { AuthUser } from "./contracts";

const apiOrigin = () =>
  process.env.AUTH_API_INTERNAL_URL ?? "http://127.0.0.1:8000";

async function serverRequest<T>(
  path: string,
): Promise<{ status: number; data: T | null }> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
  try {
    const response = await fetch(`${apiOrigin()}${path}`, {
      headers: { Cookie: cookieHeader },
      cache: "no-store",
    });
    return {
      status: response.status,
      data: response.ok ? ((await response.json()) as T) : null,
    };
  } catch {
    return { status: 503, data: null };
  }
}

export async function currentUser(): Promise<AuthUser | null> {
  const result = await serverRequest<{ user: AuthUser }>("/api/v1/auth/me");
  return result.data?.user ?? null;
}

export async function adminAccess(): Promise<boolean> {
  return (await serverRequest("/api/v1/admin/access-check")).status === 200;
}
