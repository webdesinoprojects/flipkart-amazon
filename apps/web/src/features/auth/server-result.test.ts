import { resolveAdminAccess, resolveCurrentUser } from "./server-result";
import type { AuthUser } from "./contracts";

describe("server-side account results", () => {
  it("returns the signed-in user on a successful identity check", async () => {
    const user: AuthUser = {
      id: "user-1",
      email: "seller@example.com",
      role: "user",
      emailVerified: true,
      createdAt: "2026-10-01T00:00:00Z",
      lastLoginAt: null,
    };
    expect(resolveCurrentUser({ status: 200, data: { user } })).toEqual(user);
  });

  it("treats only a 401 as signed out", async () => {
    expect(resolveCurrentUser({ status: 401, data: null })).toBeNull();
  });

  it.each([503, 500, 200])(
    "does not mistake a failed identity check (%i) for logout",
    (status) => {
      expect(() => resolveCurrentUser({ status, data: null })).toThrow(
        "Account service is temporarily unavailable.",
      );
    },
  );

  it("does not treat an unavailable admin check as a revoked role", () => {
    expect(() => resolveAdminAccess(503)).toThrow(
      "Admin access check is temporarily unavailable.",
    );
  });
});
