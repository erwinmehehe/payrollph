import { constantTimeSecretEqual } from "@/lib/security-secret";
import { isCentralSchedulerEnabled } from "@/lib/scheduler-activation";

export const dynamic = "force-dynamic";

/**
 * Authenticated, side-effect-free proof that this exact deployed revision is
 * approved to receive scheduler ticks. Never runs jobs or writes to the DB.
 * A missing Vercel system SHA must fail closed rather than dispatch to a
 * stale/unknown deployed release.
 */
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  const expectedToken = process.env.WORKER_TOKEN;
  if (!expectedToken || expectedToken !== expectedToken.trim() ||
    Buffer.byteLength(expectedToken, "utf8") < 32) {
    return Response.json({ ok: false, state: "worker-credential-unavailable" }, { status: 503, headers });
  }
  if (!constantTimeSecretEqual(request.headers.get("x-worker-token"), expectedToken)) {
    return Response.json({ ok: false, state: "unauthorized" }, { status: 401, headers });
  }
  if (!isCentralSchedulerEnabled()) {
    return Response.json({ ok: false, state: "scheduler-disabled" }, { status: 503, headers });
  }
  const deploymentSha = process.env.VERCEL_GIT_COMMIT_SHA?.trim().toLowerCase();
  if (!deploymentSha || !/^[0-9a-f]{40}$/.test(deploymentSha)) {
    return Response.json({ ok: false, state: "deployment-sha-unavailable" }, { status: 503, headers });
  }
  return Response.json({ ok: true, scheduler: "enabled", deploymentSha }, { headers });
}
