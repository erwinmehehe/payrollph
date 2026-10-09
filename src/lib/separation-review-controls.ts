export const SEPARATION_CLEARANCE_FIELDS = [
  "itCleared", "adminCleared", "financeCleared", "hrCleared",
] as const;

export type SeparationClearanceField = (typeof SEPARATION_CLEARANCE_FIELDS)[number];
export type SeparationClearanceDecision = {
  field: SeparationClearanceField;
  value: boolean;
  evidenceReference: string;
};

export function parseSeparationClearance(body: Record<string, unknown>): SeparationClearanceDecision | null {
  const fields = SEPARATION_CLEARANCE_FIELDS.filter(field =>
    Object.prototype.hasOwnProperty.call(body, field));
  if (fields.length !== 1) return null;
  const field = fields[0];
  if (typeof body[field] !== "boolean") return null;
  const evidenceReference = typeof body.evidenceReference === "string"
    ? body.evidenceReference.trim() : "";
  if (evidenceReference.length < 8 || evidenceReference.length > 200) return null;
  return { field, value: body[field], evidenceReference };
}

export function canAttestSeparationClearance(role: string, field: SeparationClearanceField) {
  // There is no standalone IT actor role yet. Until independently defined,
  // only company administrators can attest IT and general admin clearance.
  if (field === "itCleared" || field === "adminCleared") return ["owner", "admin"].includes(role);
  if (field === "financeCleared") return ["owner", "admin", "bookkeeper", "payroll"].includes(role);
  return ["owner", "admin", "hr"].includes(role);
}

export function independentFinalPayApproval(preparedByUserId: number | null, approverUserId: number) {
  if (preparedByUserId == null) return "FINAL_PAY_PREPARER_UNKNOWN" as const;
  if (preparedByUserId === approverUserId) return "FINAL_PAY_SELF_APPROVAL" as const;
  return null;
}

export function independentFinalPayRelease(
  preparedByUserId: number | null,
  approvedByUserId: number | null,
  releasingUserId: number,
) {
  if (preparedByUserId == null || approvedByUserId == null) return "FINAL_PAY_REVIEW_EVIDENCE_MISSING" as const;
  if (preparedByUserId === approvedByUserId) return "FINAL_PAY_SELF_APPROVAL" as const;
  if (preparedByUserId === releasingUserId) return "FINAL_PAY_MAKER_CANNOT_RELEASE" as const;
  return null;
}

export function validSeparationDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
