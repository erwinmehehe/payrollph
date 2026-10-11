import { operationalSecret } from "@/lib/operational-secret";
import { constantTimeSecretEqual } from "@/lib/security-secret";

export const dynamic = "force-dynamic";

// The SHA and deployment environment identify an internal rollout and may
// reveal infrastructure metadata. Readiness already has a dedicated private
// monitor token; reuse it instead of exposing this deployment probe publicly.
export async function GET(request: Request) {
  let expected: string | null;
  try {
    expected = operationalSecret("readiness");
  } catch {
    return Response.json({ error: "Readiness verification unavailable." }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (!expected || !constantTimeSecretEqual(request.headers.get("x-readiness-token"), expected)) {
    return Response.json({ error: "Not found." }, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  return Response.json(
    {
      deploymentSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      deploymentEnvironment: process.env.VERCEL_ENV ?? null,
      generatedAt: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
