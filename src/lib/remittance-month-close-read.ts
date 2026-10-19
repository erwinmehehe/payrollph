/**
 * A successful HTTP 200 is not proof that remittance certification is ready.
 * Accept only a complete response for the requested employer, legal entity and
 * calendar month; the client must never turn malformed evidence into "Ready".
 */
export type RemittanceMonthClosure = {
  id: number;
  organizationId: number;
  legalEntityId: number;
  applicableMonth: string;
  status: string;
  certifiedByName: string;
  certifiedAt: string;
  snapshotHash: string;
};

export type VerifiedRemittanceMonthClose = {
  organizationId: number;
  applicableMonth: string;
  legalEntity: { id: number; code: string | null; displayName: string };
  evaluation: {
    ready: boolean;
    blockers: string[];
    snapshotHash: string;
    agencyCount: number;
    memberCount: number;
    batches: unknown[];
    members: unknown[];
    paymentEvidence: unknown[];
    corrections: unknown[];
    issueCases: unknown[];
  };
  closure: RemittanceMonthClosure | null;
  certificationHistory: RemittanceMonthClosure[];
  certificationValid: boolean;
  certificationRole: "independent-reviewer";
};

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const nonnegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const positive = (value: unknown): value is number => nonnegative(value) && value > 0;
const text = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const sha256 = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
const month = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const timestamp = (value: unknown): value is string =>
  text(value) && Number.isFinite(Date.parse(value));
const nullableText = (value: unknown): boolean => value === null || typeof value === "string";

function validClosure(value: unknown, organizationId: number, entityId: number, applicableMonth: string): value is RemittanceMonthClosure {
  return record(value) && positive(value.id) &&
    value.organizationId === organizationId &&
    value.legalEntityId === entityId &&
    value.applicableMonth === applicableMonth &&
    text(value.status) && text(value.certifiedByName) &&
    timestamp(value.certifiedAt) && sha256(value.snapshotHash);
}

function validEvaluation(value: unknown): value is VerifiedRemittanceMonthClose["evaluation"] {
  if (!record(value) || typeof value.ready !== "boolean" ||
      !Array.isArray(value.blockers) || !value.blockers.every(text) ||
      !sha256(value.snapshotHash) ||
      !nonnegative(value.agencyCount) || !nonnegative(value.memberCount) ||
      !Array.isArray(value.batches) || !Array.isArray(value.members) ||
      !Array.isArray(value.paymentEvidence) || !Array.isArray(value.corrections) ||
      !Array.isArray(value.issueCases) ||
      value.ready !== (value.blockers.length === 0) ||
      value.agencyCount !== value.batches.length ||
      value.memberCount !== value.members.length) return false;
  if (!value.batches.every((batch: unknown) =>
    record(batch) && positive(batch.id) && text(batch.agency) &&
    text(batch.status) && sha256(batch.snapshotHash) &&
    nonnegative(batch.pendingPostingCount) && nonnegative(batch.exceptionCount))) return false;
  const batchIds = (value.batches as Array<{ id: number }>).map((batch) => batch.id);
  if (new Set(batchIds).size !== batchIds.length) return false;
  const validBatchIds = new Set(batchIds);
  if (!value.members.every((member: unknown) =>
    record(member) && positive(member.batchId) && validBatchIds.has(member.batchId) &&
    positive(member.employeeId) && text(member.postingStatus))) return false;
  if (!value.paymentEvidence.every((evidence: unknown) =>
    record(evidence) && positive(evidence.id) &&
    positive(evidence.batchId) && validBatchIds.has(evidence.batchId) &&
    text(evidence.fileName) && sha256(evidence.fileSha256) &&
    nonnegative(evidence.byteSize) && text(evidence.status))) return false;
  if (!value.corrections.every((item: unknown) =>
    record(item) && positive(item.id) && positive(item.batchId) &&
    validBatchIds.has(item.batchId))) return false;
  if (!value.issueCases.every((item: unknown) =>
    record(item) && positive(item.id) && text(item.agency))) return false;
  return true;
}

/** null = unverified, never an empty or clear result. */
export function parseRemittanceMonthCloseRead(
  value: unknown,
  expectedOrganizationId: number,
  expectedLegalEntityId: number | null,
  expectedMonth: string,
): VerifiedRemittanceMonthClose | null {
  if (!positive(expectedOrganizationId) || !month(expectedMonth) ||
      !record(value) || value.organizationId !== expectedOrganizationId ||
      value.applicableMonth !== expectedMonth ||
      !record(value.legalEntity) || !positive(value.legalEntity.id) ||
      !nullableText(value.legalEntity.code) || !text(value.legalEntity.displayName) ||
      (expectedLegalEntityId != null && value.legalEntity.id !== expectedLegalEntityId) ||
      value.certificationRole !== "independent-reviewer" ||
      typeof value.certificationValid !== "boolean" ||
      !validEvaluation(value.evaluation) ||
      !Array.isArray(value.certificationHistory)) return null;

  const entityId = value.legalEntity.id;
  if (value.closure !== null &&
      !validClosure(value.closure, expectedOrganizationId, entityId, expectedMonth)) return null;
  if (!value.certificationHistory.every((closure: unknown) =>
    validClosure(closure, expectedOrganizationId, entityId, expectedMonth))) return null;
  const history = value.certificationHistory as RemittanceMonthClosure[];
  if (new Set(history.map((item) => item.id)).size !== history.length) return null;
  if (history.length === 0 ? value.closure !== null :
      !record(value.closure) || value.closure.id !== history[0].id ||
      value.closure.snapshotHash !== history[0].snapshotHash) return null;
  const current = value.closure as RemittanceMonthClosure | null;
  const actuallyValid = current !== null &&
    current.status === "certified" &&
    current.snapshotHash === value.evaluation.snapshotHash &&
    value.evaluation.ready;
  if (value.certificationValid !== actuallyValid) return null;
  return value as VerifiedRemittanceMonthClose;
}
