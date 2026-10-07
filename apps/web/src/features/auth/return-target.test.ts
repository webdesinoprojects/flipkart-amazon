import { describe, expect, it } from "vitest";
import { safeReturnTarget } from "./return-target";

describe("safeReturnTarget", () => {
  it("keeps only protected same-origin paths", () => {
    expect(safeReturnTarget("/dashboard/security?from=login")).toBe(
      "/dashboard/security?from=login",
    );
    expect(safeReturnTarget("/admin")).toBe("/admin");
  });

  it.each([undefined, null, "", "//evil.test", "https://evil.test", "/app"])(
    "falls back for %s",
    (value) => expect(safeReturnTarget(value)).toBe("/dashboard/labels"),
  );
});
