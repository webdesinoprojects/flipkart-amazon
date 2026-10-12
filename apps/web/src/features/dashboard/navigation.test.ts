import {
  currentNavigationLabel,
  isNavigationItemActive,
  primaryNavigation,
} from "./navigation";

describe("dashboard navigation", () => {
  it("matches the overview route exactly without swallowing nested routes", () => {
    const overview = primaryNavigation[0]!;
    expect(isNavigationItemActive("/dashboard", overview)).toBe(true);
    expect(isNavigationItemActive("/dashboard/labels", overview)).toBe(false);
  });

  it("labels nested dashboard routes from their owning section", () => {
    expect(currentNavigationLabel("/dashboard/labels")).toBe("Label workspace");
    expect(currentNavigationLabel("/dashboard/history/batch-1")).toBe(
      "Batch history",
    );
  });
});
