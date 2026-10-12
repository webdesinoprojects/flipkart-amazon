import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthForm } from "./auth-form";

const { registerMock } = vi.hoisted(() => ({ registerMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
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
  it("keeps a successful registration in the success state after resetting", async () => {
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

    expect(
      await screen.findByText("Check your inbox to verify your email."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/account service is unavailable/i),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "EMAIL ADDRESS" })).toHaveValue(
      "",
    );
  });
});
