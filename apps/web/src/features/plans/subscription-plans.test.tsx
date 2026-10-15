import { render, screen } from "@testing-library/react";
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

  it("calls the guarded server cancellation and displays its result", async () => {
    requestMock.mockResolvedValueOnce(awaitingCharge).mockResolvedValueOnce({
      ...awaitingCharge,
      canCancelRenewal: false,
      pendingPlan: null,
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<SubscriptionPlans />);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "CANCEL RENEWAL" }),
    );
    expect(requestMock).toHaveBeenCalledWith(
      "/api/v1/billing/subscription/cancel",
      { method: "POST" },
      true,
    );
    expect(
      screen.queryByRole("button", { name: "CANCEL RENEWAL" }),
    ).not.toBeInTheDocument();
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
});
