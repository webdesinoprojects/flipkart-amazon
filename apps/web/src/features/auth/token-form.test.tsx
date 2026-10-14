import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TokenForm } from "./token-form";

const { verifyEmailMock } = vi.hoisted(() => ({ verifyEmailMock: vi.fn() }));

vi.mock("./browser-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./browser-api")>();
  return {
    ...actual,
    authApi: { ...actual.authApi, verifyEmail: verifyEmailMock },
  };
});

describe("TokenForm", () => {
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
