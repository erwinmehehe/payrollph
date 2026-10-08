import { createHash } from "node:crypto";

/**
 * The authoritatively reviewed position fields. This is deliberately not a
 * second position ledger: only a fingerprint and the source's identity/status
 * are frozen into the HCM business-process definition snapshot.
 */
export type HcmPositionControlRecord = {
  id: number;
  organizationId: number;
  code: string;
  status: string;
  jobProfileId: number;
  orgUnitId: number | null;
  supervisoryOrgUnitId: number | null;
  legalEntityId: number | null;
  costCenterId: number | null;
  planId: number | null;
  managerEmployeeId: number | null;
  employmentType: string;
  plannedStartDate: string | null;
  annualBudget: string;
  notes: string | null;
  updatedAt: Date;
};

export type HcmPositionSourceEvidence = {
  positionId: number;
  organizationId: number;
  expectedStatus: string;
  fingerprint: string;
};

export function positionControlFingerprint(position: HcmPositionControlRecord): string {
  const budget = Number(position.annualBudget);
  const date = new Date(position.updatedAt);
  if (!Number.isFinite(budget) || budget < 0 || !Number.isFinite(date.getTime())) {
    throw new Error("Position has invalid budget or revision evidence.");
  }

  // Fixed ordering avoids platform-dependent object serialization differences.
  return createHash("sha256").update(JSON.stringify([
    position.id,
    position.organizationId,
    position.code,
    position.status,
    position.jobProfileId,
    position.orgUnitId,
    position.supervisoryOrgUnitId,
    position.legalEntityId,
    position.costCenterId,
    position.planId,
    position.managerEmployeeId,
    position.employmentType,
    position.plannedStartDate,
    budget.toFixed(2),
    position.notes,
    date.toISOString(),
  ])).digest("hex");
}

export function freezeHcmPositionSource(position: HcmPositionControlRecord): HcmPositionSourceEvidence {
  return {
    positionId: position.id,
    organizationId: position.organizationId,
    expectedStatus: position.status,
    fingerprint: positionControlFingerprint(position),
  };
}

export function positionEvidenceFromDefinition(snapshot: unknown): HcmPositionSourceEvidence | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const sourceEvidence = (snapshot as Record<string, unknown>).sourceEvidence;
  if (!sourceEvidence || typeof sourceEvidence !== "object" || Array.isArray(sourceEvidence)) return null;
  const source = sourceEvidence as Record<string, unknown>;
  if (!Number.isSafeInteger(source.positionId) || Number(source.positionId) <= 0
    || !Number.isSafeInteger(source.organizationId) || Number(source.organizationId) <= 0
    || typeof source.expectedStatus !== "string"
    || !["planned", "approved", "open", "frozen"].includes(source.expectedStatus)
    || typeof source.fingerprint !== "string"
    || !/^[0-9a-f]{64}$/.test(source.fingerprint)) return null;

  return {
    positionId: Number(source.positionId),
    organizationId: Number(source.organizationId),
    expectedStatus: source.expectedStatus,
    fingerprint: source.fingerprint,
  };
}
