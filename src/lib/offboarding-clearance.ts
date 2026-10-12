/**
 * A-6 offboarding: source-of-truth clearance fields remain on separation_records.
 * Waivers are independently authorized exceptions and never mutate the four
 * boolean department attestations into silently "completed" values.
 */
export const OFFBOARDING_DEPARTMENTS = ["it", "admin", "finance", "hr"] as const;
export type OffboardingDepartment = typeof OFFBOARDING_DEPARTMENTS[number];
export type DepartmentClearanceField = "itCleared" | "adminCleared" | "financeCleared" | "hrCleared";
export const DEPARTMENT_FIELDS: Readonly<Record<OffboardingDepartment, DepartmentClearanceField>> = {
  it: "itCleared", admin: "adminCleared", finance: "financeCleared", hr: "hrCleared",
};
export function isOffboardingDepartment(value: unknown): value is OffboardingDepartment {
  return typeof value === "string" && OFFBOARDING_DEPARTMENTS.some(item => item === value);
}
export function waiverEvidenceValid(reason: unknown, reference: unknown): boolean {
  return typeof reason === "string" && reason.trim().length >= 20 && reason.trim().length <= 500 &&
    typeof reference === "string" && reference.trim().length >= 8 && reference.trim().length <= 200;
}
/** Company-wide independent exceptions; not the final-pay maker or an unscoped role. */
export function waiverReviewerEligible(input: {
  role: string; companyWide: boolean; actorUserId: number;
  preparedByUserId: number | null;
}): boolean {
  return input.companyWide && ["owner", "admin"].includes(input.role) &&
    Number.isSafeInteger(input.actorUserId) && input.actorUserId > 0 &&
    input.preparedByUserId !== null && input.preparedByUserId !== input.actorUserId;
}
export type OffboardingClearanceFacts = {
  organizationId: number;
  id: number;
  itCleared: boolean; adminCleared: boolean; financeCleared: boolean; hrCleared: boolean;
};
export type OffboardingWaiverSnapshot = {
  organizationId: number; separationId: number; department: string;
  reason: string; evidenceReference: string; revokedAt: Date | null;
};
export function offboardingClearanceStatus(
  separation: OffboardingClearanceFacts, waivers: readonly OffboardingWaiverSnapshot[],
): { ready: boolean; missing: OffboardingDepartment[]; waived: OffboardingDepartment[] } {
  const waived: OffboardingDepartment[] = [];
  const missing: OffboardingDepartment[] = [];
  for (const dept of OFFBOARDING_DEPARTMENTS) {
    if (separation[DEPARTMENT_FIELDS[dept]]) continue;
    const evidence = waivers.find(w => w.organizationId === separation.organizationId &&
      w.separationId === separation.id && w.department === dept && w.revokedAt === null &&
      waiverEvidenceValid(w.reason, w.evidenceReference));
    if (evidence) waived.push(dept);
    else missing.push(dept);
  }
  return { ready: missing.length === 0, missing, waived };
}

/** Waiving physical equipment cannot waive access revocation. */
export function externalAccessRevoked(grantStates: readonly string[]): boolean {
  return grantStates.every(state => state === "revoked");
}
