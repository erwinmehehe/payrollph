import { NextResponse, type NextRequest } from "next/server";
import { multiEntityHcmDeferred } from "@/lib/multi-entity-hcm-hold";

/**
 * Fail closed for ALL unreviewed HCM HTTP endpoints when multi-entity is ON.
 * Independent entity/tenant review is needed before removing this hold.
 * The normal HCM experience remains unchanged when the feature is OFF.
 */
export function proxy(request: NextRequest) {
  // /hcm itself is a public marketing page. All authenticated HCM
  // application pages and API endpoints must remain inaccessible while
  // their employer/tenant isolation is not reviewed.
  const path = request.nextUrl.pathname;
  const guarded = path === "/api/hcm" || path.startsWith("/api/hcm/") ||
    (path.startsWith("/hcm/") && path !== "/hcm/");
  if (guarded && multiEntityHcmDeferred()) {
    return NextResponse.json({
      error: "HCM APIs are unavailable until multi-entity employer isolation is reviewed.",
      code: "ENTITY_HCM_DEFERRED",
    }, { status: 403, headers: { "Cache-Control": "private, no-store" } });
  }
  return NextResponse.next();
}

export const config = { matcher: ["/api/hcm/:path*", "/hcm/:path*"] };
