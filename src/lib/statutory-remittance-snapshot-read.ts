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
const month = (v: unknown) => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const date = (v: unknown) => typeof v === "string" &&
  /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v) &&
  Number.isFinite(Date.parse(v + "T00:00:00Z")) &&
  new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v;
const count = (v: unknown) => typeof v === "number" &&
  Number.isSafeInteger(v) && v >= 0;
const money = (v: unknown) =>
  typeof v === "string" && /^-?\d+(?:\.\d+)?$/.test(v) && Number.isFinite(Number(v));
const optional = (v: unknown, fn: (v: unknown) => boolean) => v === null || fn(v);
const agency = (v: unknown) => v === "SSS" || v === "PhilHealth" || v === "Pag-IBIG";

function validBatch(v: unknown, organizationId: number, legalEntityId: number, today: string): v is Record<string, unknown> {
  return record(v) && id(v.id) && v.organizationId === organizationId &&
    v.legalEntityId === legalEntityId &&
    agency(v.agency) && month(v.applicableMonth) &&
    date(v.dueDate) &&
    ["open", "paid", "exception", "reconciled"].includes(String(v.status)) &&
    v.displayStatus === (v.status === "open" && (v.dueDate as string) < today ? "overdue" : v.status) &&
    count(v.employeeCount) &&
    money(v.expectedEmployeeShare) && money(v.expectedEmployerShare) &&
    money(v.expectedTotal) && optional(v.amountPaid, money) &&
    optional(v.paymentReference, (x) => typeof x === "string") &&
    optional(v.agencyReceiptReference, (x) => typeof x === "string") &&
    optional(v.paidAt, (x) => typeof x === "string") &&
    count(v.pendingPostingCount) && count(v.exceptionCount) &&
    number(v.paymentShortfall) && v.paymentShortfall >= 0 &&
    // Shortfall is derived evidence; a forged zero must not suppress a warning.
    Math.abs(v.paymentShortfall - Math.max(0, Number(v.expectedTotal) - Number(v.amountPaid ?? 0))) <= 0.011 &&
    typeof v.hasActivePaymentProof === "boolean" &&
    // State construction always provides a complete matched/mismatch/unverified
    // filing snapshot. Its omission must not hide an accepted-filing mismatch.
    record(v.filingCheck) &&
    ["matched", "mismatch", "unverified"].includes(String(v.filingCheck.status)) &&
    count(v.filingCheck.remittanceEmployeeCount) &&
    number(v.filingCheck.remittanceTotal) &&
    v.filingCheck.remittanceEmployeeCount === v.employeeCount &&
    Math.abs(v.filingCheck.remittanceTotal - Number(v.expectedTotal)) <= 0.011 &&
    optional(v.filingCheck.filingRecordId, id) &&
    optional(v.filingCheck.filingEmployeeCount, count) &&
    optional(v.filingCheck.filingTotal, number) &&
    optional(v.filingCheck.employeeCountDifference, number) &&
    optional(v.filingCheck.totalDifference, number) &&
    // A matched/mismatched accepted filing must carry actual filing evidence.
    // Otherwise the UI's nullish-to-zero presentation could invent a zero total.
    (v.filingCheck.status === "unverified" ||
      (id(v.filingCheck.filingRecordId) &&
       count(v.filingCheck.filingEmployeeCount) &&
       number(v.filingCheck.filingTotal) &&
       number(v.filingCheck.employeeCountDifference) &&
       number(v.filingCheck.totalDifference) &&
       (v.filingCheck.status !== "matched" ||
         (v.filingCheck.filingEmployeeCount === v.employeeCount &&
          Math.abs(v.filingCheck.filingTotal - Number(v.expectedTotal)) <= 0.011 &&
          v.filingCheck.employeeCountDifference === 0 &&
          Math.abs(v.filingCheck.totalDifference) <= 0.011))));
}

function validMember(v: unknown, organizationId: number, legalEntityId: number, validBatches: Set<number>): v is Record<string, unknown> {
  return record(v) && id(v.id) && v.organizationId === organizationId && v.legalEntityId === legalEntityId &&
    id(v.batchId) && validBatches.has(v.batchId) && id(v.employeeId) &&
    typeof v.employeeNo === "string" && money(v.employeeShare) &&
    money(v.employerShare) && money(v.totalContribution) &&
    ["pending", "confirmed", "exception"].includes(String(v.postingStatus)) &&
    optional(v.postingReference, (x) => typeof x === "string") &&
    optional(v.postedAmount, money) &&
    optional(v.postingEvidenceArtifactId, id) &&
    optional(v.postingEvidenceSource, (x) => typeof x === "string") &&
    optional(v.postingEvidenceHashSha256, (x) => typeof x === "string") &&
    optional(v.postingEvidenceFileName, (x) => typeof x === "string") &&
    optional(v.postingEvidenceByteSize, number) &&
    optional(v.exceptionNote, (x) => typeof x === "string") &&
    // A member cannot be 'confirmed' with no amount or agency-posting proof.
    (v.postingStatus !== "confirmed" ||
      (typeof v.postingReference === "string" && v.postingReference.trim().length > 0 &&
       money(v.postedAmount) && id(v.postingEvidenceArtifactId) &&
       typeof v.postingEvidenceHashSha256 === "string" &&
       /^[a-f0-9]{64}$/i.test(v.postingEvidenceHashSha256)));
}

export function isVerifiedRemittanceSnapshot(
  value: unknown, organizationId: number, legalEntityId: number | null,
): value is VerifiedRemittanceSnapshot {
  if (!id(organizationId) || (legalEntityId !== null && !id(legalEntityId)) ||
      !record(value) || value.organizationId !== organizationId ||
      !date(value.today) ||
      !record(value.legalEntity) || !id(value.legalEntity.id) ||
      typeof value.legalEntity.code !== "string" ||
      typeof value.legalEntity.displayName !== "string" ||
      (legalEntityId !== null && value.legalEntity.id !== legalEntityId) ||
      !Array.isArray(value.batches) || !Array.isArray(value.members) ||
      !Array.isArray(value.coverageGaps) || !Array.isArray(value.alerts)) return false;
  const entityId = value.legalEntity.id as number;
  if (!value.batches.every((v: unknown) => validBatch(v, organizationId, entityId, value.today as string))) return false;
  const batchIds = new Set<number>(value.batches.map((v) => v.id as number));
  if (batchIds.size !== value.batches.length) return false;
  if (!value.members.every((v: unknown) => validMember(v, organizationId, entityId, batchIds))) return false;
  const memberIds = new Set<number>(value.members.map((v) => v.id as number));
  if (memberIds.size !== value.members.length) return false;
  // Counts powering reconciled/all-clear messages must agree with actual rows.
  const seenEmployees = new Set<string>();
  for (const member of value.members) {
    const key = `${member.batchId}:${member.employeeId}`;
    if (seenEmployees.has(key)) return false;
    seenEmployees.add(key);
  }
  for (const batch of value.batches) {
    const rows = value.members.filter((member) => member.batchId === batch.id);
    if (rows.length !== batch.employeeCount ||
        rows.filter((member) => member.postingStatus === "pending").length !== batch.pendingPostingCount ||
        rows.filter((member) => member.postingStatus === "exception").length !== batch.exceptionCount) return false;
    if (batch.status === "reconciled" &&
        (batch.pendingPostingCount !== 0 || batch.exceptionCount !== 0 ||
         batch.paymentShortfall > 0.01 || !batch.hasActivePaymentProof)) return false;
  }
  return value.coverageGaps.every((v: unknown) =>
    record(v) && agency(v.agency) && month(v.applicableMonth) &&
    optional(v.dueDate, date));
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
