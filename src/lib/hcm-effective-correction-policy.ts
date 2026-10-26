import { createHash } from "node:crypto";

export const HCM_CORRECTION_RETURNED = "returned_for_correction";
export function correctionNote(value: unknown): string {
  if (typeof value !== "string" || value.trim().length < 10 || value.trim().length > 500) {
    throw new Error("A correction reason of 10–500 characters is required.");
  }
  return value.trim();
}
export function correctionDate(value: unknown, today: string): string {
  if (typeof value !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)
    || value.startsWith("0000-") || !Number.isFinite(Date.parse(value + "T00:00:00Z"))
    || new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value || value < today) {
    throw new Error("Correction effective date must be a real date no earlier than today.");
  }
  return value;
}
export function correctionFingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
/** First source-specific lane: existing employment-type-only intent. */
export function assertCorrectableEmploymentChange(change: {
  movementType: string; targetPositionId: number | null; toSnapshot: unknown;
  approvedByUserId: number | null; approvedAt: Date | null; appliedAt: Date | null;
  targetEmploymentType: string | null; targetOrgUnitId: number | null;
  targetSupervisoryOrgUnitId: number | null; targetLegalEntityId: number | null;
  targetCostCenterId: number | null; targetManagerEmployeeId: number | null;
  targetEmployeeStatus: string | null; targetFte: string | null;
}) {
  const to = change.toSnapshot as { changes?: Record<string, unknown> } | null;
  const keys = to?.changes && typeof to.changes === "object" ? Object.keys(to.changes) : [];
  if (change.movementType !== "employment_type_change" || change.targetPositionId !== null
    || keys.length !== 1 || keys[0] !== "employmentType"
    || typeof to?.changes?.employmentType !== "string" || !to.changes.employmentType.trim()
    || to.changes.employmentType !== change.targetEmploymentType
    || [change.targetOrgUnitId, change.targetSupervisoryOrgUnitId, change.targetLegalEntityId,
      change.targetCostCenterId, change.targetManagerEmployeeId, change.targetEmployeeStatus, change.targetFte].some(value => value !== null)
    || change.approvedByUserId !== null || change.approvedAt !== null || change.appliedAt !== null) {
    throw new Error("Only unapplied, unapproved employment-type-only changes support correction in this version.");
  }
}
