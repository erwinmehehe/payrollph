import { operationalSecret } from "@/lib/operational-secret";
import { constantTimeSecretEqual } from "@/lib/security-secret";

export const dynamic = "force-dynamic";
const NO_CACHE = { "Cache-Control": "no-store", Vary: "x-readiness-token" };

// A protected, READ-ONLY explanation of the same production demo-employer gate
// used by demo-switch. Never disclose employer identifiers, names or counts.
// This diagnostic is not proof that any demo persona successfully authenticated.
export async function GET(request: Request) {
  let secret: string | null;
  try {
    secret = operationalSecret("readiness");
  } catch {
    return Response.json({ error: "Readiness verification unavailable." }, {
      status: 503, headers: NO_CACHE,
    });
  }
  if (!secret || !constantTimeSecretEqual(request.headers.get("x-readiness-token"), secret)) {
    return Response.json({ error: "Not found." }, { status: 404, headers: NO_CACHE });
  }
  const { productionDemoEmployerBoundary } = await import("@/lib/demo-provisioning-boundary");
  const demoProvisioning = await productionDemoEmployerBoundary();
  return Response.json({
    deploymentSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    demoProvisioning,
    evidenceScope: "PRIVATE_DEMO_GUARD_ONLY_NOT_PERSONA_ACCEPTANCE",
  }, { headers: NO_CACHE });
}
