import { buildReadinessPayload } from "@/lib/operational-readiness";
import { constantTimeSecretEqual } from "@/lib/security-secret";
import { operationalSecret } from "@/lib/operational-secret";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  {
    const expected = operationalSecret("readiness") ?? operationalSecret("worker");
    if (!expected) {
      return Response.json(
        { error: "Not found." },
        { status: 404 },
      );
    }
    const supplied = request.headers.get("x-readiness-token") ?? request.headers.get("x-worker-token");
    if (!constantTimeSecretEqual(supplied, expected)) {
      return Response.json({ error: "A valid readiness token is required." }, { status: 401 });
    }
  }

  return Response.json(await buildReadinessPayload(), {
    headers: { "Cache-Control": "no-store" },
  });
}
