import { render, screen } from "@testing-library/react";
import { SupportContact } from "./support-contact";

describe("SupportContact", () => {
  it("shows the support address in account settings", () => {
    render(<SupportContact />);
    expect(screen.getByText("sellerlabels@gmail.com")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "EMAIL SUPPORT" })).toHaveAttribute(
      "href",
      expect.stringContaining("mailto:sellerlabels@gmail.com"),
    );
    expect(
      screen.getByRole("link", { name: /contact details/i }),
    ).toHaveAttribute("href", "/contact");
  });

  it("makes billing questions explicit on the plans page", () => {
    render(<SupportContact billing />);
    expect(
      screen.getByText(/plan, payment, or more daily credits/i),
    ).toBeInTheDocument();
  });
});
