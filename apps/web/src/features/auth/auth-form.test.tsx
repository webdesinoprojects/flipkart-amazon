import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthForm } from "./auth-form";

const { pushMock, registerMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  registerMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: pushMock, refresh: vi.fn() }),
}));

vi.mock("./browser-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./browser-api")>();
  return {
    ...actual,
    authApi: {
      ...actual.authApi,
      register: registerMock,
    },
  };
});

describe("AuthForm", () => {
  it("sends a delivered registration to the cross-device OTP screen", async () => {
    registerMock.mockResolvedValueOnce({
      status: "accepted",
      delivery: "sent",
      message: "Check your inbox to verify your email.",
    });
    const user = userEvent.setup();

    render(<AuthForm mode="register" />);
    await user.type(
      screen.getByRole("textbox", { name: "EMAIL ADDRESS" }),
      "seller@example.com",
    );
    await user.type(screen.getByLabelText(/^PASSWORD/), "long-passphrase");
    await user.click(screen.getByRole("button", { name: "CREATE ACCOUNT" }));

    expect(pushMock).toHaveBeenCalledWith(
      "/verify-email?email=seller%40example.com",
    );
  });
});
