import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreditGrantDialog } from "./credit-grant-dialog";

const { requestMock, refreshMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  refreshMock: vi.fn(),
}));
vi.mock("@/features/auth/browser-api", () => ({
  browserApiRequest: requestMock,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

beforeEach(() => {
  requestMock.mockReset();
  refreshMock.mockReset();
});

describe("CreditGrantDialog", () => {
  it("asks for an explicit reason and posts one expiring pool through the protected API", async () => {
    requestMock.mockResolvedValue({ id: "grant-1" });
    const user = userEvent.setup();
    render(
      <CreditGrantDialog customerId="user-1" email="seller@example.com" />,
    );
    await user.click(screen.getByRole("button", { name: "Grant credits" }));
    expect(
      screen.getByRole("dialog", { name: "Grant one-time credits" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Grant 100 credits" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      /reason of at least 8 characters/i,
    );
    expect(requestMock).not.toHaveBeenCalled();
    await user.type(
      screen.getByLabelText("Reason for this grant"),
      "Support adjustment",
    );
    await user.click(screen.getByRole("button", { name: "7 days" }));
    await user.click(screen.getByRole("button", { name: "Grant 100 credits" }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledOnce());
    const [path, init, csrf] = requestMock.mock.calls[0]!;
    expect(path).toBe("/api/v1/admin/users/user-1/credit-grants");
    expect(csrf).toBe(true);
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.amount).toBe(100);
    expect(body.reason).toBe("Support adjustment");
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(
      Date.now() + 6 * 86_400_000,
    );
    await waitFor(() => expect(refreshMock).toHaveBeenCalledOnce());
  });
});
