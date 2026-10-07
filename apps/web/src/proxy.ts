import { NextRequest, NextResponse } from "next/server";

const protectedPaths = ["/dashboard", "/admin", "/app"];
export function proxy(request: NextRequest) {
  const protectedRoute = protectedPaths.some(
    (path) =>
      request.nextUrl.pathname === path ||
      request.nextUrl.pathname.startsWith(`${path}/`),
  );
  if (!protectedRoute) return NextResponse.next();
  const hasSession =
    request.cookies.has("ln_session") ||
    request.cookies.has("__Host-ln_session");
  if (hasSession) return NextResponse.next();
  const login = new URL("/login", request.url);
  const target = request.nextUrl.pathname.startsWith("/app")
    ? "/dashboard/labels"
    : `${request.nextUrl.pathname}${request.nextUrl.search}`;
  login.searchParams.set("returnTo", target);
  return NextResponse.redirect(login);
}
export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*", "/app/:path*"],
};
