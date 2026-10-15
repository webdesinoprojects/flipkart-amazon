import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TokenForm } from "./token-form";

const { verifyEmailMock, resetPasswordMock } = vi.hoisted(() => ({
  verifyEmailMock: vi.fn(),
  resetPasswordMock: vi.fn(),
}));

vi.mock("./browser-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./browser-api")>();
  return {
    ...actual,
    authApi: {
      ...actual.authApi,
      verifyEmail: verifyEmailMock,
      resetPassword: resetPasswordMock,
    },
  };
});

beforeEach(() => {
  verifyEmailMock.mockClear();
  resetPasswordMock.mockClear();
});

describe("TokenForm", () => {
  it("allows a four-character password on the reset form", () => {
    render(<TokenForm mode="reset" token="opaque-token" />);
    expect(screen.getByLabelText("NEW PASSWORD")).toHaveAttribute(
      "minlength",
      "4",
    );
  });

  it("shows reset success and clears the form after the request resolves", async () => {
    resetPasswordMock.mockResolvedValueOnce({ status: "password_updated" });
    const user = userEvent.setup();
    render(<TokenForm mode="reset" token="opaque-token" />);

    await user.type(screen.getByLabelText("NEW PASSWORD"), "abcd");
    await user.click(screen.getByRole("button", { name: "UPDATE PASSWORD" }));

    expect(resetPasswordMock).toHaveBeenCalledWith("opaque-token", "abcd");
    expect(await screen.findByText(/Password updated/i)).toBeInTheDocument();
    expect(screen.getByLabelText("NEW PASSWORD")).toHaveValue("");
    expect(
      screen.queryByText(/service is unavailable/i),
    ).not.toBeInTheDocument();
  });

  it("reveals and hides the new password without submitting", async () => {
    const user = userEvent.setup();
    render(<TokenForm mode="reset" token="opaque-token" />);

    const password = screen.getByLabelText("NEW PASSWORD");
    expect(password).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(password).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(password).toHaveAttribute("type", "password");
    expect(resetPasswordMock).not.toHaveBeenCalled();
  });

  it("confirms a six-digit code against the registration email", async () => {
    verifyEmailMock.mockResolvedValueOnce({ status: "verified" });
    const user = userEvent.setup();
    render(<TokenForm mode="verify" token="" email="seller@example.com" />);

    expect(screen.getByLabelText("EMAIL ADDRESS")).toHaveValue(
      "seller@example.com",
    );
    await user.type(
      screen.getByLabelText("6-DIGIT VERIFICATION CODE"),
      "370030",
    );
    await user.click(screen.getByRole("button", { name: "VERIFY EMAIL" }));

    expect(verifyEmailMock).toHaveBeenCalledWith({
      email: "seller@example.com",
      code: "370030",
    });
    expect(await screen.findByText(/Email verified/i)).toBeInTheDocument();
  });

  it("keeps secure-link verification available as a fallback", async () => {
    verifyEmailMock.mockResolvedValueOnce({ status: "verified" });
    const user = userEvent.setup();
    render(<TokenForm mode="verify" token="opaque-token" />);

    expect(screen.queryByLabelText("EMAIL ADDRESS")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "VERIFY EMAIL" }));
    expect(verifyEmailMock).toHaveBeenCalledWith({ token: "opaque-token" });
  });
});
