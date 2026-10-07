import { fireEvent, render, screen } from "@testing-library/react";
import ErrorPage from "./error";
import NotFound from "./not-found";

describe("public recovery screens", () => {
  it("offers retry without exposing an exception", () => {
    const retry = vi.fn();
    render(
      <ErrorPage
        error={Object.assign(new Error("secret internal detail"), {
          digest: "safe-123",
        })}
        retry={retry}
      />,
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(
      "secret internal detail",
    );
    expect(screen.getByText("REFERENCE: safe-123")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /TRY AGAIN/ }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "BACK TO HOME" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("offers safe routes on a missing page", () => {
    render(<NotFound />);
    expect(screen.getByRole("link", { name: "OPEN THE APP" })).toHaveAttribute(
      "href",
      "/app",
    );
    expect(screen.getByRole("main")).not.toHaveTextContent("Error:");
  });

  it("does not expose an unsafe digest", () => {
    render(
      <ErrorPage
        error={Object.assign(new Error("internal"), {
          digest: "customer@example.com",
        })}
        retry={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(
      "customer@example.com",
    );
  });
});
