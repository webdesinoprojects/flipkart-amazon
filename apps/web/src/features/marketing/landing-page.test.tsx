import { render, screen } from "@testing-library/react";
import { LandingPage } from "./landing-page";

describe("public landing page", () => {
  it("shows the product sections and a working app entry point", () => {
    render(<LandingPage />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "ONE BATCH.EVERY MARKETPLACE.PRINT READY.",
    );
    for (const name of [
      /FROM MIXED PDFS/,
      /ONE WORKFLOW/,
      /THE DETAILS/,
      /A PLAN FOR/,
      /YOUR DOCUMENTS/,
    ]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(
      screen.getAllByRole("link", { name: /START PROCESSING/ }),
    ).toHaveLength(2);
    expect(
      screen
        .getAllByRole("link", { name: /START PROCESSING/ })
        .every((link) => link.getAttribute("href") === "/app"),
    ).toBe(true);
    for (const link of document.querySelectorAll<HTMLAnchorElement>(
      'a[href^="#"]',
    )) {
      expect(document.querySelector(link.getAttribute("href")!)).not.toBeNull();
    }
    expect(document.querySelector('a[href="#"]')).toBeNull();
  });
});
