export type UserRole = "user" | "admin";

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  emailVerified: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AccountSession {
  id: string;
  deviceSummary: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

export interface ApiErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    fields?: Record<string, string>;
    requestId?: string;
  };
}

export interface AcceptedResponse {
  status: "accepted";
  delivery: "sent" | "disabled" | "failed";
  message: string;
}
