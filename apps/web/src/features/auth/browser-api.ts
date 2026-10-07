import type {
  AcceptedResponse,
  AccountSession,
  ApiErrorEnvelope,
  AuthUser,
} from "./contracts";

export class AuthApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = "request_failed",
  ) {
    super(message);
  }
}

function csrfFromCookie(): string {
  if (typeof document === "undefined") return "";
  const cookie = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find(
      (part) =>
        part.startsWith("ln_csrf=") || part.startsWith("__Host-ln_csrf="),
    );
  return cookie
    ? decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1))
    : "";
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  csrf = false,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (csrf) {
    let token = csrfFromCookie();
    if (!token) {
      const response = await fetch("/api/v1/auth/csrf", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (response.ok)
        token = ((await response.json()) as { csrfToken: string }).csrfToken;
    }
    if (token) headers.set("X-CSRF-Token", token);
  }
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    let payload: ApiErrorEnvelope = {};
    try {
      payload = (await response.json()) as ApiErrorEnvelope;
    } catch {
      // An upstream HTML or empty error must still become a safe UI message.
    }
    throw new AuthApiError(
      payload.error?.message ??
        "The request could not be completed. Please try again.",
      response.status,
      payload.error?.code,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const authApi = {
  register: (email: string, password: string) =>
    request<AcceptedResponse>("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  login: (email: string, password: string) =>
    request<{ user: AuthUser; csrfToken: string }>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () =>
    request<{ status: string }>(
      "/api/v1/auth/logout",
      { method: "POST" },
      true,
    ),
  forgotPassword: (email: string) =>
    request<AcceptedResponse>("/api/v1/auth/password/forgot", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  resetPassword: (token: string, password: string) =>
    request<{ status: string }>("/api/v1/auth/password/reset", {
      method: "POST",
      body: JSON.stringify({ token, password }),
    }),
  verifyEmail: (token: string) =>
    request<{ status: string; user: AuthUser }>(
      "/api/v1/auth/verify-email/confirm",
      {
        method: "POST",
        body: JSON.stringify({ token }),
      },
    ),
  requestVerification: (email: string) =>
    request<AcceptedResponse>("/api/v1/auth/verify-email/request", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  sessions: async () =>
    (await request<{ sessions: AccountSession[] }>("/api/v1/auth/sessions"))
      .sessions,
  revokeSession: (id: string) =>
    request<void>(
      `/api/v1/auth/sessions/${encodeURIComponent(id)}`,
      { method: "DELETE" },
      true,
    ),
};
