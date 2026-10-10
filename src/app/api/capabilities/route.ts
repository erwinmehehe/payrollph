import { operationalSecret } from "@/lib/operational-secret";
import { constantTimeSecretEqual } from "@/lib/security-secret";
import { buildCapabilityReport } from "@/lib/capabilities";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // This report carries operational counts and payment configuration; the
  // public /scorecard page remains available as a separate marketing view.
  const expected = operationalSecret("readiness");
  if (!expected || !constantTimeSecretEqual(request.headers.get("x-readiness-token"), expected)) {
    return Response.json({ error: "Not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json(await buildCapabilityReport(), { headers: { "Cache-Control": "no-store" } });
}
