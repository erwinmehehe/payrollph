/** Statutory payment/posting controls require a complete single-employer snapshot. */
export type VerifiedRemittanceSnapshot = {
  organizationId: number;
  legalEntity: { id: number };
  batches: Record<string, unknown>[];
  members: Record<string, unknown>[];
  coverageGaps: Record<string, unknown>[];
  alerts: unknown[];
};

const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const number = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const month = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}$/.test(v);
const money = (v: unknown) =>
  typeof v === "string" && /^-?\d+(?:\.\d+)?$/.test(v) && Number.isFinite(Number(v));
const optional = (v: unknown, fn: (v: unknown) => boolean) => v === null || fn(v);
const agency = (v: unknown) => v === "SSS" || v === "PhilHealth" || v === "Pag-IBIG";

function validBatch(v: unknown, organizationId: number, legalEntityId: number): v is Record<string, unknown> {
  return record(v) && id(v.id) && v.organizationId === organizationId &&
    v.legalEntityId === legalEntityId &&
    agency(v.agency) && month(v.applicableMonth) &&
    typeof v.dueDate === "string" && typeof v.status === "string" &&
    typeof v.displayStatus === "string" && number(v.employeeCount) &&
    money(v.expectedEmployeeShare) && money(v.expectedEmployerShare) &&
    money(v.expectedTotal) && optional(v.amountPaid, money) &&
    optional(v.paymentReference, (x) => typeof x === "string") &&
    optional(v.agencyReceiptReference, (x) => typeof x === "string") &&
    optional(v.paidAt, (x) => typeof x === "string") &&
    number(v.pendingPostingCount) && number(v.exceptionCount) &&
    (v.filingCheck === undefined ||
      (record(v.filingCheck) &&
        ["matched", "mismatch", "unverified"].includes(String(v.filingCheck.status)) &&
        number(v.filingCheck.remittanceEmployeeCount) &&
        number(v.filingCheck.remittanceTotal) &&
        optional(v.filingCheck.filingRecordId, id) &&
        optional(v.filingCheck.filingEmployeeCount, number) &&
        optional(v.filingCheck.filingTotal, number) &&
        optional(v.filingCheck.employeeCountDifference, number) &&
        optional(v.filingCheck.totalDifference, number)));
}

function validMember(v: unknown, organizationId: number, validBatches: Set<number>): v is Record<string, unknown> {
  return record(v) && id(v.id) && v.organizationId === organizationId &&
    id(v.batchId) && validBatches.has(v.batchId) && id(v.employeeId) &&
    typeof v.employeeNo === "string" && money(v.employeeShare) &&
    money(v.employerShare) && money(v.totalContribution) &&
    typeof v.postingStatus === "string" &&
    optional(v.postingReference, (x) => typeof x === "string") &&
    optional(v.postedAmount, money) &&
    optional(v.postingEvidenceArtifactId, id) &&
    optional(v.postingEvidenceSource, (x) => typeof x === "string") &&
    optional(v.postingEvidenceHashSha256, (x) => typeof x === "string") &&
    optional(v.postingEvidenceFileName, (x) => typeof x === "string") &&
    optional(v.postingEvidenceByteSize, number) &&
    optional(v.exceptionNote, (x) => typeof x === "string");
}

export function isVerifiedRemittanceSnapshot(
  value: unknown, organizationId: number, legalEntityId: number | null,
): value is VerifiedRemittanceSnapshot {
  if (!id(organizationId) || !record(value) || value.organizationId !== organizationId ||
      !record(value.legalEntity) || !id(value.legalEntity.id) ||
      (legalEntityId !== null && value.legalEntity.id !== legalEntityId) ||
      !Array.isArray(value.batches) || !Array.isArray(value.members) ||
      !Array.isArray(value.coverageGaps) || !Array.isArray(value.alerts)) return false;
  const entityId = value.legalEntity.id as number;
  if (!value.batches.every((v: unknown) => validBatch(v, organizationId, entityId))) return false;
  const batchIds = new Set<number>(value.batches.map((v) => v.id as number));
  if (batchIds.size !== value.batches.length) return false;
  if (!value.members.every((v: unknown) => validMember(v, organizationId, batchIds))) return false;
  const memberIds = new Set<number>(value.members.map((v) => v.id as number));
  if (memberIds.size !== value.members.length) return false;
  return value.coverageGaps.every((v: unknown) =>
    record(v) && agency(v.agency) && month(v.applicableMonth) &&
    optional(v.dueDate, (x) => typeof x === "string"));
}

export async function readVerifiedRemittanceSnapshot(
  organizationId: number, legalEntityId: number | null,
  fetcher: typeof fetch = fetch, signal?: AbortSignal,
): Promise<VerifiedRemittanceSnapshot> {
  const response = await fetcher(
    `/api/compliance/statutory-remittances?organizationId=${organizationId}${legalEntityId ? `&legalEntityId=${legalEntityId}` : ""}`,
    { cache: "no-store", signal },
  );
  if (!response.ok) throw new Error("Statutory remittance source could not be loaded.");
  let body: unknown;
  try { body = await response.json(); }
  catch { throw new Error("Statutory remittance source returned malformed JSON."); }
  if (!isVerifiedRemittanceSnapshot(body, organizationId, legalEntityId)) {
    throw new Error("Statutory payment and posting evidence could not be verified for this employer.");
  }
  return body;
}
