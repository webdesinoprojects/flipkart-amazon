import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SubscriptionPlans } from "./subscription-plans";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock("@/features/auth/browser-api", () => ({
  browserApiRequest: requestMock,
}));

const awaitingCharge = {
  available: true,
  activePlan: "Early access",
  currentStatus: null,
  dailyCredits: 100,
  paidThrough: null,
  renews: false,
  pendingPlan: "Scale",
  pendingStatus: "active",
  pendingCheckoutUrl: null,
  canCancelCheckout: false,
  canCancelRenewal: true,
};

beforeEach(() => requestMock.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("SubscriptionPlans", () => {
  it("never offers immediate checkout cancellation while payment confirmation is pending", async () => {
    requestMock.mockResolvedValueOnce(awaitingCharge);
    render(<SubscriptionPlans />);
    expect(
      await screen.findByText(/payment confirmation is being checked/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "CANCEL OPEN CHECKOUT" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "CANCEL RENEWAL" }),
    ).toBeInTheDocument();
  });

  it("requires an in-page confirmation before the guarded cancellation", async () => {
    requestMock.mockResolvedValueOnce(awaitingCharge).mockResolvedValueOnce({
      ...awaitingCharge,
      canCancelRenewal: false,
      pendingPlan: null,
    });
    render(<SubscriptionPlans />);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "CANCEL RENEWAL" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Stop automatic renewal?" }),
    ).toBeInTheDocument();
    expect(requestMock).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "STOP RENEWAL" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/billing/subscription/cancel",
        { method: "POST" },
        true,
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "CANCEL RENEWAL" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("keeps an open checkout when the safe dialog action is chosen", async () => {
    requestMock.mockResolvedValueOnce({
      ...awaitingCharge,
      pendingPlan: "Starter",
      pendingStatus: "created",
      canCancelCheckout: true,
      canCancelRenewal: false,
    });
    render(<SubscriptionPlans />);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "CANCEL OPEN CHECKOUT" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Cancel this checkout?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/only cancel if you have not paid/i),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "KEEP CHECKOUT" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the dialog open and shows a server cancellation error", async () => {
    requestMock
      .mockResolvedValueOnce(awaitingCharge)
      .mockRejectedValueOnce(new Error("Payment state needs review."));
    render(<SubscriptionPlans />);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "CANCEL RENEWAL" }),
    );
    await user.click(screen.getByRole("button", { name: "STOP RENEWAL" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Payment state needs review.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("does not claim a halted subscription will renew", async () => {
    requestMock.mockResolvedValueOnce({
      ...awaitingCharge,
      activePlan: "Starter",
      paidThrough: "2026-11-15T00:00:00Z",
      pendingPlan: null,
      pendingStatus: null,
    });
    render(<SubscriptionPlans />);
    expect(
      await screen.findByText(/renewal needs attention/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/renews automatically each month/i),
    ).not.toBeInTheDocument();
  });

  it("does not offer a cancellation button for an unconfirmed mandate", async () => {
    requestMock.mockResolvedValueOnce({
      ...awaitingCharge,
      pendingStatus: "authenticated",
      canCancelRenewal: false,
    });
    render(<SubscriptionPlans />);
    expect(
      await screen.findByText(
        /contact support to cancel while payment is being checked/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /cancel/i }),
    ).not.toBeInTheDocument();
  });

  it("does not call an authenticated mandate cancelled or offer an unusable action", async () => {
    requestMock.mockResolvedValueOnce({
      ...awaitingCharge,
      activePlan: "Starter",
      currentStatus: "authenticated",
      paidThrough: "2026-11-15T00:00:00Z",
      pendingPlan: null,
      pendingStatus: null,
      canCancelRenewal: false,
    });
    render(<SubscriptionPlans />);
    expect(
      await screen.findByText(/mandate state is being checked/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/renewal is cancelled/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /cancel/i }),
    ).not.toBeInTheDocument();
  });

  it("shows full-price stacked-credit terms before starting a paid upgrade", async () => {
    requestMock.mockResolvedValueOnce({
      ...awaitingCharge,
      activePlan: "Starter",
      dailyCredits: 300,
      currentStatus: "active",
      paidThrough: "2026-11-15T00:00:00Z",
      pendingPlan: null,
      pendingStatus: null,
      canCancelRenewal: true,
    });
    render(<SubscriptionPlans />);
    const upgradeButtons = await screen.findAllByRole("button", {
      name: /upgrade to/i,
    });
    expect(upgradeButtons).toHaveLength(2);
    expect(screen.getByRole("button", { name: "CURRENT PLAN" })).toBeDisabled();
    await userEvent.setup().click(upgradeButtons[0]!);
    expect(
      screen.getByRole("dialog", { name: "Add Growth capacity?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/full ₹199 monthly subscription/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/1,000 credits/i)).toBeInTheDocument();
    expect(requestMock).toHaveBeenCalledTimes(1);
  });
});
