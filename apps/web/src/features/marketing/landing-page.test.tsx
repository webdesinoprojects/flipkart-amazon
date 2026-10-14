import { fireEvent, render, screen } from "@testing-library/react";
import { LandingPage } from "./landing-page";

describe("public landing page", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("reduced-motion"),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  it("shows the product sections and a working app entry point", () => {
    render(<LandingPage />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Shipping labels in.Print-ready PDFs out.",
    );
    for (const name of [
      /See exactly what stays/,
      /FROM MIXED PDFS/,
      /ONE WORKFLOW/,
      /THE DETAILS/,
      /BEFORE YOURFIRST BATCH/,
      /START FREE/,
      /YOUR DOCUMENTS/,
    ]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(
      screen.getByRole("link", { name: /START PROCESSING/ }),
    ).toHaveAttribute("href", "/register");
    expect(
      screen.getByRole("link", { name: /Crop my labels free/ }),
    ).toHaveAttribute("href", "/register");

    const heroVideo = document.querySelector("video");
    expect(heroVideo).toHaveAttribute("autoplay");
    expect(heroVideo).toHaveAttribute("loop");
    expect(heroVideo).toHaveAttribute("playsinline");

    fireEvent.click(screen.getByRole("tab", { name: /Amazon/ }));
    expect(
      screen.getByRole("img", {
        name: /Amazon original PDF beside its extracted print-ready shipping label/,
      }),
    ).toBeInTheDocument();
    for (const link of document.querySelectorAll<HTMLAnchorElement>(
      'a[href^="#"]',
    )) {
      expect(document.querySelector(link.getAttribute("href")!)).not.toBeNull();
    }
    expect(document.querySelector('a[href="#"]')).toBeNull();
  });
});
