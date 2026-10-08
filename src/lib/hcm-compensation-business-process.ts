import { createHash } from "node:crypto";

/**
 * A compensation BP reviews a frozen recommendation. It is NOT authority to
 * schedule a salary revision: the existing owner/finance compensation endpoint
 * must still independently validate bands, budget, current pay and payroll.
 */
export type HcmCompensationReview = {
  organizationId: number;
  proposalId: number;
  employeeId: number;
  employeeOrgUnitId: number | null;
  cycleId: number;
  cycleStatus: string;
  cycleEffectiveDate: string;
  cycleBudgetPool: string;
  bandId: number;
  bandMinimumAnnual: string;
  bandMidpointAnnual: string;
  bandMaximumAnnual: string;
  currentAnnual: string;
  proposedAnnual: string;
  reason: string;
  workerEffectiveChangeId: number | null;
};

export type HcmCompensationEvidence = {
  organizationId: number;
  proposalId: number;
  employeeId: number;
  fingerprint: string;
};

export function compensationReviewFingerprint(value: HcmCompensationReview): string {
  if (!Number.isSafeInteger(value.organizationId) || value.organizationId <= 0
    || !Number.isSafeInteger(value.proposalId) || value.proposalId <= 0
    || !Number.isSafeInteger(value.employeeId) || value.employeeId <= 0
    || !Number.isSafeInteger(value.cycleId) || value.cycleId <= 0
    || !Number.isSafeInteger(value.bandId) || value.bandId <= 0
    || !/^\d{4}-\d{2}-\d{2}$/.test(value.cycleEffectiveDate)) {
    throw new Error("Invalid compensation approval source.");
  }

  return createHash("sha256").update(JSON.stringify([
    value.organizationId, value.proposalId, value.employeeId, value.employeeOrgUnitId,
    value.cycleId, value.cycleStatus, value.cycleEffectiveDate, value.cycleBudgetPool,
    value.bandId, value.bandMinimumAnnual, value.bandMidpointAnnual, value.bandMaximumAnnual,
    value.currentAnnual, value.proposedAnnual, value.reason, value.workerEffectiveChangeId,
  ])).digest("hex");
}

export function freezeCompensationReview(value: HcmCompensationReview): HcmCompensationEvidence {
  return {
    organizationId: value.organizationId,
    proposalId: value.proposalId,
    employeeId: value.employeeId,
    fingerprint: compensationReviewFingerprint(value),
  };
}

export function compensationEvidenceFromDefinition(snapshot: unknown): HcmCompensationEvidence | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const evidence = (snapshot as Record<string, unknown>).sourceEvidence;
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return null;
  const row = evidence as Record<string, unknown>;
  if (!Number.isSafeInteger(row.organizationId) || Number(row.organizationId) <= 0
    || !Number.isSafeInteger(row.proposalId) || Number(row.proposalId) <= 0
    || !Number.isSafeInteger(row.employeeId) || Number(row.employeeId) <= 0
    || typeof row.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(row.fingerprint)) return null;
  return {
    organizationId: Number(row.organizationId),
    proposalId: Number(row.proposalId),
    employeeId: Number(row.employeeId),
    fingerprint: row.fingerprint,
  };
}
