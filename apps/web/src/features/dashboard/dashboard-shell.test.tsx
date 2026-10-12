import { fireEvent, render, screen } from "@testing-library/react";
import { DashboardShell } from "./dashboard-shell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/features/auth/browser-api", () => ({
  authApi: { logout: vi.fn() },
}));

const user = {
  id: "user-1",
  email: "seller@example.com",
  role: "user" as const,
  emailVerified: true,
  createdAt: "2026-10-07T00:00:00Z",
  lastLoginAt: null,
};

describe("DashboardShell", () => {
  it("starts in the light theme and exposes the product routes", () => {
    const { container } = render(
      <DashboardShell user={user}>
        <p>Dashboard content</p>
      </DashboardShell>,
    );

    expect(container.firstElementChild).toHaveAttribute("data-theme", "light");
    expect(
      screen.getAllByRole("link", { name: /workspace/i }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("link", { name: /credits/i }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByRole("link", { name: /admin/i }),
    ).not.toBeInTheDocument();
  });

  it("switches the dashboard to dark mode without a browser-native select", () => {
    const { container } = render(
      <DashboardShell user={user}>
        <p>Dashboard content</p>
      </DashboardShell>,
    );

    fireEvent.click(
      screen.getByRole("switch", { name: "Use dark dashboard theme" }),
    );
    expect(container.firstElementChild).toHaveAttribute("data-theme", "dark");
  });

  it("collapses and restores the desktop sidebar", () => {
    const { container } = render(
      <DashboardShell user={user}>
        <p>Dashboard content</p>
      </DashboardShell>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(container.firstElementChild).toHaveAttribute(
      "data-sidebar",
      "collapsed",
    );
    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(container.firstElementChild).toHaveAttribute(
      "data-sidebar",
      "expanded",
    );
  });
});
