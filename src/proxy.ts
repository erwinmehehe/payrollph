import { NextRequest, NextResponse } from "next/server";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const secFetchSite = request.headers.get("sec-fetch-site");

  // Non-browser/server-to-server callers commonly omit Origin/Sec-Fetch-Site.
  if (!origin) return secFetchSite !== "cross-site";
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

/**
 * Defense-in-depth CSRF/origin gate for cookie-authenticated API mutations.
 * API clients and internal workers without browser Origin headers keep working,
 * while cross-site browser POST/PATCH/DELETE requests are rejected before route code runs.
 */
export function proxy(request: NextRequest) {
  if (
    request.nextUrl.pathname.startsWith("/api/") &&
    UNSAFE_METHODS.has(request.method.toUpperCase()) &&
    !sameOrigin(request)
  ) {
    return NextResponse.json({ error: "Cross-origin state-changing requests are not allowed." }, { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
