/**
 * Verified loan remittance evidence. An absent, foreign or partial 200 is
 * not a legitimate zero liability or permission to record payment.
 */
export type GovernmentLoanBatch = {
  id: number; organizationId: number; legalEntityId: number;
  agency: "SSS" | "Pag-IBIG"; applicableMonth: string;
  dueDate: string; status: string; displayStatus: string;
  employeeCount: number; loanCount: number; expectedTotal: string;
  amountPaid: string | null; pendingPostingCount: number; exceptionCount: number;
};
export type GovernmentLoanMember = {
  id: number; organizationId: number; legalEntityId: number;
  batchId: number; employeeId: number; employeeNo: string;
  loanType: string; loanReferenceNo: string; deductedAmount: string;
  postingStatus: string; postedAmount: string | null;
  postingReference: string | null; exceptionNote: string | null;
};
export type GovernmentLoanRead = {
  organizationId: number; legalEntityId: number; today: string;
  legalEntity: {id: number; code: string | null; displayName: string};
  batches: GovernmentLoanBatch[];
  members: GovernmentLoanMember[];
};
const obj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const nonnegative = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const money = (v: unknown): v is string =>
  typeof v === "string" && /^\d{1,12}(?:\.\d{1,4})?$/.test(v) &&
  Number.isFinite(Number(v));
const day = (v: unknown): v is string => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const parsed = Date.parse(v + "T00:00:00.000Z");
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0,10) === v;
};
const month = (v: unknown): v is string => typeof v === "string" &&
  /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
function batch(v: unknown, organizationId: number, legalEntityId: number, today: string): v is GovernmentLoanBatch {
  if (!obj(v) || !id(v.id) || v.organizationId !== organizationId ||
      v.legalEntityId !== legalEntityId ||
      !["SSS", "Pag-IBIG"].includes(String(v.agency)) || !month(v.applicableMonth) ||
      !day(v.dueDate) || !["open","paid","exception","reconciled"].includes(String(v.status)) ||
      !nonnegative(v.employeeCount) || !nonnegative(v.loanCount) ||
      !money(v.expectedTotal) || !(v.amountPaid === null || money(v.amountPaid)) ||
      !nonnegative(v.pendingPostingCount) || !nonnegative(v.exceptionCount)) return false;
  return v.displayStatus === (v.status === "open" && v.dueDate < today ? "overdue" : v.status);
}
function member(v: unknown, organizationId: number, legalEntityId: number): v is GovernmentLoanMember {
  return obj(v) && id(v.id) && v.organizationId === organizationId &&
    v.legalEntityId === legalEntityId && id(v.batchId) && id(v.employeeId) &&
    typeof v.employeeNo === "string" && text(v.loanType) &&
    text(v.loanReferenceNo) && money(v.deductedAmount) &&
    ["pending", "confirmed", "exception"].includes(String(v.postingStatus)) &&
    (v.postedAmount === null || money(v.postedAmount)) &&
    (v.postingReference === null || typeof v.postingReference === "string") &&
    (v.exceptionNote === null || typeof v.exceptionNote === "string") &&
    (v.postingStatus !== "confirmed" || (money(v.postedAmount) && text(v.postingReference)));
}
export function isVerifiedGovernmentLoanRemittanceRead(
  v: unknown, organizationId: number,
): v is GovernmentLoanRead {
  if (!id(organizationId) || !obj(v) || v.organizationId !== organizationId ||
      !id(v.legalEntityId) || !day(v.today) ||
      !obj(v.legalEntity) || v.legalEntity.id !== v.legalEntityId ||
      !(v.legalEntity.code === null || typeof v.legalEntity.code === "string") ||
      !text(v.legalEntity.displayName) || !Array.isArray(v.batches) ||
      !Array.isArray(v.members) || v.batches.length > 5000 || v.members.length > 20000) return false;
  const entityId = v.legalEntityId;
  if (!v.batches.every((b: unknown) => batch(b, organizationId, entityId, v.today as string)) ||
      !v.members.every((m: unknown) => member(m, organizationId, entityId))) return false;
  const batches = v.batches as GovernmentLoanBatch[];
  const members = v.members as GovernmentLoanMember[];
  const ids = new Set(batches.map(b => b.id));
  if (ids.size !== batches.length ||
      new Set(members.map(m => m.id)).size !== members.length ||
      members.some(m => !ids.has(m.batchId))) return false;
  for (const b of batches) {
    const rows = members.filter(m => m.batchId === b.id);
    if (rows.length !== b.loanCount ||
        new Set(rows.map(r => r.employeeId)).size !== b.employeeCount ||
        rows.filter(r => r.postingStatus === "pending").length !== b.pendingPostingCount ||
        rows.filter(r => r.postingStatus === "exception").length !== b.exceptionCount) return false;
    const expectedCents = Math.round(Number(b.expectedTotal) * 100);
    const memberCents = rows.reduce((sum, row) => sum + Math.round(Number(row.deductedAmount) * 100), 0);
    if (memberCents !== expectedCents) return false;
  }
  return true;
}
