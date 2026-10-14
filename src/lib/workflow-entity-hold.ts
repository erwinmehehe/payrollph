import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";

/**
 * The ten-workflow draft predates mandatory legal-employer grants.
 * Its legacy organization-wide routes MUST NOT operate when multi-entity is
 * enabled, even for company owners or anonymous career applicants.
 *
 * Explicit deny-only transport guard; does not grant access when null.
 * Lift only after reviewed entity-scoped route/query/UI acceptance.
 */
export function workflowEntityHold(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Response | null {
  if (!criticalReleaseFlagEnabled("multiEntity", env)) return null;
  return Response.json({
    code: "ENTITY_WORKFLOW_DEFERRED",
    error: "This workflow requires verified legal-employer authorization before multi-entity use.",
  }, { status: 403, headers: {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  } });
}
