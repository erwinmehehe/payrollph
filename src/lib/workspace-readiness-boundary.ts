/**
 * Deployment-wide evidence may include counts from other employers. An
 * organization administrator is not an internal platform operator.
 *
 * This tenant route deliberately reports unavailable until a separate,
 * fully employer-scoped readiness snapshot and validator are implemented.
 * Protected platform monitoring via /api/readiness remains unchanged.
 */
export function tenantReadinessUnavailable(organizationId: number): Response {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "A valid employer selection is required." }, {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return Response.json({
    code: "WORKSPACE_READINESS_UNAVAILABLE",
    error: "Readiness evidence is unavailable for this employer. No launch or pilot status has been verified.",
  }, {
    status: 503,
    headers: { "Cache-Control": "no-store" },
  });
}
