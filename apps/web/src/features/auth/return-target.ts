const DEFAULT_TARGET = "/dashboard/labels";

export function safeReturnTarget(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return DEFAULT_TARGET;
  }
  try {
    const parsed = new URL(value, "http://local.invalid");
    if (parsed.origin !== "http://local.invalid") return DEFAULT_TARGET;
    if (
      !parsed.pathname.startsWith("/dashboard") &&
      parsed.pathname !== "/admin"
    ) {
      return DEFAULT_TARGET;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return DEFAULT_TARGET;
  }
}
