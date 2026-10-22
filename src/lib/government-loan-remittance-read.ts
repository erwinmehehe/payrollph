/**
 * Evidence-only government-loan remittance read. A network error, missing
 * collection, partial financial row or foreign employer cannot mean zero
 * liabilities, zero posting exceptions, or permission to record a payment.
 */
export type VerifiedGovernmentLoanBatch = {
  id: number; organizationId: number; legalEntityId: number;
  agency: "SSS" | "Pag-IBIG"; applicableMonth: string; dueDate: string;
  status: "open" | "paid" | "reconciled" | "exception";
  displayStatus: "open" | "paid" | "reconciled" | "exception" | "overdue";
  employeeCount: number; loanCount: number; expectedTotal: string;
  amountPaid: string | null; pendingPostingCount: number; exceptionCount: number;
};
export type VerifiedGovernmentLoanMember = {
  id: number; batchId: number; organizationId: number; legalEntityId: number;
  employeeNo: string; loanType: string; loanReferenceNo: string;
  deductedAmount: string; postingStatus: "pending" | "confirmed" | "exception";
  postedAmount: string | null; postingReference: string | null;
  exceptionNote: string | null;
};
export type VerifiedGovernmentLoanRead = {
  organizationId: number;
  today: string;
  legalEntity: { id: number; code: string; displayName: string };
  batches: VerifiedGovernmentLoanBatch[];
  members: VerifiedGovernmentLoanMember[];
};
const record = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === "object" && !Array.isArray(x);
const id = (x: unknown): x is number =>
  typeof x === "number" && Number.isSafeInteger(x) && x > 0;
const count = (x: unknown): x is number =>
  typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
const text = (x: unknown): x is string =>
  typeof x === "string" && x.trim().length > 0;
const optionalText = (x: unknown) => x === null || typeof x === "string";
const money = (x: unknown): x is string =>
  typeof x === "string" && /^(?:0|[1-9][0-9]{0,12})(?:\.[0-9]{1,2})?$/.test(x) && Number.isFinite(Number(x));
const date = (x: unknown): x is string => {
  if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
  const millis = Date.parse(x + "T00:00:00Z");
  return Number.isFinite(millis) && new Date(millis).toISOString().slice(0, 10) === x;
};
const month = (x: unknown): x is string =>
  typeof x === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(x);

/** Exact integer-cent arithmetic; floating-point totals must never certify remittances. */
function cents(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}
function validBatch(value: unknown, org: number, entity: number): value is VerifiedGovernmentLoanBatch {
  if (!record(value)) return false;
  return id(value.id) && value.organizationId === org && value.legalEntityId === entity &&
    (value.agency === "SSS" || value.agency === "Pag-IBIG") &&
    month(value.applicableMonth) && date(value.dueDate) &&
    ["open", "paid", "reconciled", "exception"].includes(String(value.status)) &&
    (value.displayStatus === value.status || (value.displayStatus === "overdue" && value.status === "open")) &&
    count(value.employeeCount) && count(value.loanCount) &&
    money(value.expectedTotal) &&
    (value.amountPaid === null || money(value.amountPaid)) &&
    count(value.pendingPostingCount) && count(value.exceptionCount);
}
function validMember(value: unknown, org: number, entity: number): value is VerifiedGovernmentLoanMember {
  if (!record(value)) return false;
  return id(value.id) && id(value.batchId) &&
    value.organizationId === org && value.legalEntityId === entity &&
    text(value.employeeNo) && text(value.loanType) && text(value.loanReferenceNo) &&
    money(value.deductedAmount) &&
    ["pending", "confirmed", "exception"].includes(String(value.postingStatus)) &&
    (value.postedAmount === null || money(value.postedAmount)) &&
    optionalText(value.postingReference) && optionalText(value.exceptionNote) &&
    (value.postingStatus !== "confirmed" ||
      (money(value.postedAmount) && text(value.postingReference)));
}
export function isVerifiedGovernmentLoanRead(
  value: unknown, organizationId: number, legalEntityId: number,
): value is VerifiedGovernmentLoanRead {
  if (!id(organizationId) || !id(legalEntityId) ||
      !record(value) || value.organizationId !== organizationId ||
      !date(value.today) || !record(value.legalEntity) ||
      value.legalEntity.id !== legalEntityId || !text(value.legalEntity.code) ||
      !text(value.legalEntity.displayName) ||
      !Array.isArray(value.batches) || value.batches.length > 5000 ||
      !Array.isArray(value.members) || value.members.length > 50000) return false;
  const entityId = value.legalEntity.id as number;
  if (!value.batches.every((row: unknown) => validBatch(row, organizationId, entityId)) ||
      !value.members.every((row: unknown) => validMember(row, organizationId, entityId))) return false;
  const batches = value.batches as VerifiedGovernmentLoanBatch[];
  const members = value.members as VerifiedGovernmentLoanMember[];
  if (new Set(batches.map(row => row.id)).size !== batches.length ||
      new Set(members.map(row => row.id)).size !== members.length) return false;
  const ids = new Set(batches.map(row => row.id));
  if (members.some(row => !ids.has(row.batchId))) return false;
  for (const batch of batches) {
    const related = members.filter(row => row.batchId === batch.id);
    if (batch.loanCount !== related.length ||
        batch.employeeCount !== new Set(related.map(row => row.employeeNo)).size ||
        cents(batch.expectedTotal) !== related.reduce(
          (sum, member) => sum + cents(member.deductedAmount), 0n,
        ) ||
        batch.pendingPostingCount !== related.filter(row => row.postingStatus === "pending").length ||
        batch.exceptionCount !== related.filter(row => row.postingStatus === "exception").length) return false;
  }
  return true;
}
export async function readVerifiedGovernmentLoanRemittances(
  organizationId: number, legalEntityId: number,
  fetcher: typeof fetch = fetch, signal?: AbortSignal,
): Promise<VerifiedGovernmentLoanRead> {
  if (!id(organizationId) || !id(legalEntityId))
    throw Error("Government loan remittances unavailable until a legal employer is selected.");
  const response = await fetcher(
    "/api/compliance/government-loan-remittances?organizationId=" + organizationId +
      "&legalEntityId=" + legalEntityId,
    { cache: "no-store", signal },
  );
  if (!response.ok) throw Error("Government loan remittance evidence unavailable. Retry.");
  let value: unknown;
  try { value = await response.json(); }
  catch { throw Error("Government loan remittance evidence returned malformed JSON. Retry."); }
  if (!isVerifiedGovernmentLoanRead(value, organizationId, legalEntityId)) {
    throw Error("Government loan remittance evidence incomplete or for another employer. Retry.");
  }
  return value;
}
