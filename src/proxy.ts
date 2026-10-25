import { NextResponse, type NextRequest } from "next/server";
import { multiEntityHcmDeferred } from "@/lib/multi-entity-hcm-hold";
import { nonceContentSecurityPolicy } from "@/lib/nonce-csp";

/**
 * Keep the existing HCM employer-isolation embargo independent of CSP.
 * Nonce mode is opt-in and requires a matching build/runtime configuration
 * plus server-rendered browser acceptance before production enablement.
 */
export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const guarded = path === "/api/hcm" || path.startsWith("/api/hcm/") ||
    (path.startsWith("/hcm/") && path !== "/hcm/");
  if (guarded && multiEntityHcmDeferred()) {
    return NextResponse.json({
      error: "HCM APIs are unavailable until multi-entity employer isolation is reviewed.",
      code: "ENTITY_HCM_DEFERRED",
    }, { status: 403, headers: { "Cache-Control": "private, no-store" } });
  }

  // APIs never return executable HTML and retain existing no-store rules.
  // All HTML routes must use the same CSP for framework nonce extraction and
  // the browser. No client-supplied nonce is trusted.
  if (process.env.NEXT_CSP_ENABLED !== "true" || path === "/api" ||
      path.startsWith("/api/")) return NextResponse.next();

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = nonceContentSecurityPolicy(nonce, process.env.NODE_ENV === "development");
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: [
    "/api/hcm/:path*",
    "/hcm/:path*",
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
