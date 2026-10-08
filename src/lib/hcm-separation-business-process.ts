import { createHash } from "node:crypto";

/**
 * Independent HCM approval of separation intent. Final-pay amounts, tax,
 * loans, clearance, 2316 and payout remain with their separate payroll-owned
 * approvals and live source-fingerprint controls.
 */
export type HcmSeparationIntent = {
  organizationId: number;
  employeeId: number;
  employeeStatus: string;
  employeeOrgUnitId: number | null;
  employeeStartDate: string;
  employmentTermDecisionId: number | null;
  separationType: string;
  noticeDate: string;
  lastDay: string;
};

export type HcmSeparationEvidence = {
  organizationId: number;
  employeeId: number;
  fingerprint: string;
};

export function separationIntentFingerprint(value: HcmSeparationIntent): string {
  if (!Number.isSafeInteger(value.organizationId) || value.organizationId <= 0
    || !Number.isSafeInteger(value.employeeId) || value.employeeId <= 0
    || !/^\d{4}-\d{2}-\d{2}$/.test(value.employeeStartDate)
    || !/^\d{4}-\d{2}-\d{2}$/.test(value.noticeDate)
    || !/^\d{4}-\d{2}-\d{2}$/.test(value.lastDay)
    || value.noticeDate > value.lastDay
    || value.lastDay < value.employeeStartDate) {
    throw new Error("Separation intent has invalid worker identity or effective dates.");
  }
  return createHash("sha256").update(JSON.stringify([
    value.organizationId, value.employeeId,
    value.employeeStatus, value.employeeOrgUnitId, value.employeeStartDate,
    value.employmentTermDecisionId, value.separationType,
    value.noticeDate, value.lastDay,
  ])).digest("hex");
}

export function freezeSeparationIntent(value: HcmSeparationIntent): HcmSeparationEvidence {
  return {
    organizationId: value.organizationId,
    employeeId: value.employeeId,
    fingerprint: separationIntentFingerprint(value),
  };
}

export function separationEvidenceFromDefinition(snapshot: unknown): HcmSeparationEvidence | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const raw = (snapshot as Record<string, unknown>).sourceEvidence;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  if (!Number.isSafeInteger(source.organizationId) || Number(source.organizationId) <= 0
    || !Number.isSafeInteger(source.employeeId) || Number(source.employeeId) <= 0
    || typeof source.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(source.fingerprint)) return null;
  return {
    organizationId: Number(source.organizationId),
    employeeId: Number(source.employeeId),
    fingerprint: source.fingerprint,
  };
}
