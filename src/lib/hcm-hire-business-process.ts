import { createHash } from "node:crypto";

/** Data reviewed before a candidate may become an authoritative worker. */
export type HireReviewContext = {
  applicantId: number;
  requisitionId: number;
  positionId: number;
  applicantStage: string;
  applicantEmail: string;
  offeredMonthly: string;
  requisitionStatus: string;
  positionCode: string;
  positionStatus: string;
  positionUpdatedAt: string;
  positionOrgUnitId: number | null;
  positionLegalEntityId: number | null;
  positionPlanId: number | null;
  positionAnnualBudget: string;
  profileTitle: string;
  employeeNo: string;
  firstName: string;
  middleName: string;
  lastName: string;
  startDate: string;
  region: string;
  nationality: string;
  mwe: boolean;
  payBasis: string;
  rateAmount: string;
  standardWorkDaysPerMonth: string;
  standardHoursPerDay: string;
};

export type HireApprovalEvidence = {
  applicantId: number;
  requisitionId: number;
  positionId: number;
  fingerprint: string;
};

export function hireReviewFingerprint(value: HireReviewContext): string {
  if (!Number.isSafeInteger(value.applicantId) || value.applicantId <= 0
    || !Number.isSafeInteger(value.requisitionId) || value.requisitionId <= 0
    || !Number.isSafeInteger(value.positionId) || value.positionId <= 0
    || !/^\d{4}-\d{2}-\d{2}$/.test(value.startDate)) {
    throw new Error("Hire review has invalid candidate, position or start-date evidence.");
  }
  // Fixed property ordering guarantees deterministic fingerprints across
  // request, approval and final employee/position conversion transactions.
  return createHash("sha256").update(JSON.stringify([
    value.applicantId, value.requisitionId, value.positionId,
    value.applicantStage, value.applicantEmail.toLowerCase(),
    value.offeredMonthly, value.requisitionStatus,
    value.positionCode, value.positionStatus, value.positionUpdatedAt,
    value.positionOrgUnitId, value.positionLegalEntityId, value.positionPlanId,
    value.positionAnnualBudget, value.profileTitle,
    value.employeeNo, value.firstName, value.middleName, value.lastName,
    value.startDate, value.region, value.nationality, value.mwe,
    value.payBasis, value.rateAmount,
    value.standardWorkDaysPerMonth, value.standardHoursPerDay,
  ])).digest("hex");
}

export function freezeHireApproval(value: HireReviewContext): HireApprovalEvidence {
  return {
    applicantId: value.applicantId,
    requisitionId: value.requisitionId,
    positionId: value.positionId,
    fingerprint: hireReviewFingerprint(value),
  };
}

export function hireEvidenceFromDefinition(snapshot: unknown): HireApprovalEvidence | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const evidence = (snapshot as Record<string, unknown>).sourceEvidence;
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return null;
  const source = evidence as Record<string, unknown>;
  if (!Number.isSafeInteger(source.applicantId) || Number(source.applicantId) <= 0
    || !Number.isSafeInteger(source.requisitionId) || Number(source.requisitionId) <= 0
    || !Number.isSafeInteger(source.positionId) || Number(source.positionId) <= 0
    || typeof source.fingerprint !== "string"
    || !/^[0-9a-f]{64}$/.test(source.fingerprint)) return null;
  return {
    applicantId: Number(source.applicantId),
    requisitionId: Number(source.requisitionId),
    positionId: Number(source.positionId),
    fingerprint: source.fingerprint,
  };
}
