/**
 * Fail closed in multi-entity mode until historical entries, final pay,
 * profiles and DOLE submissions can be attributed to a legal employer.
 * Those schema tables currently contain organization_id but not legal_entity_id.
 * Never infer historical employer ownership from the employee's current value.
 */
export const DOLE_ENTITY_SOURCE_UNAVAILABLE = "DOLE_ENTITY_SOURCE_ATTRIBUTION_REQUIRED";

export function unavailableMultiEntityDoleReport(enabled: boolean): Response | null {
  if (!enabled) return null;
  return Response.json({
    code: DOLE_ENTITY_SOURCE_UNAVAILABLE,
    error: "DOLE 13th-month reporting is unavailable until historical payroll, final pay and submission evidence can be attributed to one legal employer.",
  }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
}

export function assertSingleEmployerDoleSource(enabled: boolean): void {
  if (enabled) throw new Error(DOLE_ENTITY_SOURCE_UNAVAILABLE);
}
