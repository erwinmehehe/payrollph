/**
 * Verified loan remittance evidence. An absent, foreign or partial 200 is
 * not a legitimate zero liability or permission to record payment.
 */
export type GovernmentLoanBatch = {
  id: number; organizationId: number; legalEntityId: number;
  agency: "SSS" | "Pag-IBIG"; applicableMonth: string;
  dueDate: string; status: string; displayStatus: string;
  employeeCount: number; loanCount: number; expectedTotal: string;
  amountPaid: string | null; paymentReference: string | null;
  agencyAcknowledgementReference: string | null; paymentVarianceNote: string | null;
  paidAt: string | null; updatedAt: string;
  pendingPostingCount: number; exceptionCount: number;
};
export type GovernmentLoanMember = {
  id: number; organizationId: number; legalEntityId: number;
  batchId: number; employeeId: number; employeeNo: string;
  loanType: string; loanReferenceNo: string; deductedAmount: string;
  postingStatus: string; postedAmount: string | null;
  postingReference: string | null; exceptionNote: string | null;
  updatedAt: string;
};
export type GovernmentLoanRead = {
  organizationId: number; legalEntityId: number; today: string;
  legalEntity: {id: number; code: string | null; displayName: string};
  batches: GovernmentLoanBatch[];
  members: GovernmentLoanMember[];
};
const obj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

export function parseGovernmentLoanRemittanceRead(
  ok: boolean, value: unknown, organizationId: number,
): GovernmentLoanRead | null {
  return ok && isVerifiedGovernmentLoanRemittanceRead(value, organizationId) ? value : null;
}
const id = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const nonnegative = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
// PostgreSQL remittance amounts use scale 2. Keeping cents as safe integers
// avoids rounding away a partially posted peso amount or an extra decimal.
const cents = (v: unknown): number | null => {
  if (typeof v !== "string") return null;
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(v);
  if (!match) return null;
  const value = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(value) ? value : null;
};
const money = (v: unknown): v is string => cents(v) !== null;
const timestamp = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v) &&
  Number.isFinite(Date.parse(v));
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
      !day(v.dueDate) || !["open", "paid", "exception", "reconciled"].includes(String(v.status)) ||
      !timestamp(v.updatedAt) || !nonnegative(v.employeeCount) ||
      !nonnegative(v.loanCount) || v.employeeCount === 0 || v.loanCount === 0 ||
      v.employeeCount > v.loanCount ||
      !money(v.expectedTotal) || (cents(v.expectedTotal) ?? 0) <= 0 ||
      !nonnegative(v.pendingPostingCount) || !nonnegative(v.exceptionCount) ||
      v.pendingPostingCount + v.exceptionCount > v.loanCount) return false;
  if (v.displayStatus !== (v.status === "open" && v.dueDate < today ? "overdue" : v.status))
    return false;

  if (v.status === "open") return v.amountPaid === null;

  const expected = cents(v.expectedTotal);
  const paid = cents(v.amountPaid);
  if (expected === null || paid === null || paid <= 0 || paid + 1 < expected ||
      !text(v.paymentReference) || !text(v.agencyAcknowledgementReference) ||
      !timestamp(v.paidAt)) return false;
  if (paid > expected + 1 && !text(v.paymentVarianceNote)) return false;
  return true;
}
function member(v: unknown, organizationId: number, legalEntityId: number): v is GovernmentLoanMember {
  if (!obj(v) || !id(v.id) || v.organizationId !== organizationId ||
      v.legalEntityId !== legalEntityId || !id(v.batchId) || !id(v.employeeId) ||
      !text(v.employeeNo) || !text(v.loanType) || !text(v.loanReferenceNo) ||
      !timestamp(v.updatedAt) ||
      !money(v.deductedAmount) || (cents(v.deductedAmount) ?? 0) <= 0 ||
      !["pending", "confirmed", "exception"].includes(String(v.postingStatus))) return false;
  const deducted = cents(v.deductedAmount);
  const posted = cents(v.postedAmount);
  if (v.postingStatus === "confirmed") {
    return deducted !== null && posted !== null && posted > 0 &&
      Math.abs(posted - deducted) <= 1 && text(v.postingReference) &&
      v.exceptionNote === null;
  }
  if (v.postedAmount !== null || v.postingReference !== null) return false;
  return v.postingStatus === "exception" ? text(v.exceptionNote) : v.exceptionNote === null;
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
    const expectedCents = cents(b.expectedTotal);
    const memberCents = rows.reduce((sum, row) => sum + (cents(row.deductedAmount) ?? 0), 0);
    if (expectedCents === null || !Number.isSafeInteger(memberCents) ||
        memberCents !== expectedCents) return false;
    if (b.status === "reconciled" &&
        (b.pendingPostingCount !== 0 || b.exceptionCount !== 0 ||
         rows.some(row => row.postingStatus !== "confirmed"))) return false;
    if (b.status === "exception" && b.exceptionCount === 0) return false;
    if (b.status === "open" && rows.some(row => row.postingStatus !== "pending"))
      return false;
  }
  return true;
}

/**
 * A successful POST receipt is not enough: the fresh GET must show the exact
 * changed record and revision, rather than an unrelated or stale 200.
 */
export function isConfirmedGovernmentLoanMutation(
  action: string,
  payload: Record<string, unknown>,
  response: unknown,
  read: GovernmentLoanRead,
): boolean {
  if (!obj(response) || !id(read.organizationId) || !id(read.legalEntityId)) return false;
  const isCurrent = (receipt: Record<string, unknown>, current: Record<string, unknown>): boolean =>
    id(receipt.id) && receipt.id === current.id &&
    receipt.organizationId === read.organizationId &&
    receipt.legalEntityId === read.legalEntityId &&
    timestamp(receipt.updatedAt) && receipt.updatedAt === current.updatedAt;

  if (action === "create_batch" || action === "record_payment") {
    if (!obj(response.batch) || !id(response.batch.id)) return false;
    const receipt = response.batch;
    const current = read.batches.find(row => row.id === receipt.id);
    if (!current || !isCurrent(receipt, current)) return false;
    if (action === "create_batch") {
      return receipt.status === "open" && current.status === "open" &&
        receipt.agency === payload.agency && current.agency === payload.agency &&
        receipt.applicableMonth === payload.applicableMonth &&
        current.applicableMonth === payload.applicableMonth;
    }
    const amount = payload.amountPaid;
    if (current.id !== payload.batchId || typeof amount !== "number" ||
        !Number.isFinite(amount) || amount <= 0) return false;
    const submittedCents = Math.round(amount * 100);
    const paid = cents(receipt.amountPaid);
    return Number.isSafeInteger(submittedCents) && paid !== null &&
      paid === submittedCents && cents(current.amountPaid) === paid &&
      receipt.status === "paid" && current.status === "paid" &&
      text(receipt.paymentReference) &&
      receipt.paymentReference === current.paymentReference &&
      receipt.paymentReference === String(payload.paymentReference ?? "").trim() &&
      text(receipt.agencyAcknowledgementReference) &&
      receipt.agencyAcknowledgementReference === current.agencyAcknowledgementReference &&
      receipt.agencyAcknowledgementReference === String(payload.agencyAcknowledgementReference ?? "").trim() &&
      timestamp(receipt.paidAt) && receipt.paidAt === current.paidAt;
  }

  if (action !== "confirm_member_posting" && action !== "mark_member_exception") return false;
  if (!obj(response.member) || !id(response.member.id)) return false;
  const receipt = response.member;
  const current = read.members.find(row => row.id === receipt.id);
  if (!current || !isCurrent(receipt, current) || current.id !== payload.memberId ||
      receipt.batchId !== current.batchId) return false;
  if (action === "confirm_member_posting") {
    const requested = payload.postedAmount;
    if (typeof requested !== "number" || !Number.isFinite(requested) || requested <= 0)
      return false;
    const submittedCents = Math.round(requested * 100);
    return Number.isSafeInteger(submittedCents) &&
      receipt.postingStatus === "confirmed" && current.postingStatus === "confirmed" &&
      cents(receipt.postedAmount) === submittedCents &&
      cents(current.postedAmount) === submittedCents &&
      text(receipt.postingReference) &&
      receipt.postingReference === current.postingReference &&
      receipt.postingReference === String(payload.postingReference ?? "").trim();
  }
  return receipt.postingStatus === "exception" && current.postingStatus === "exception" &&
    text(receipt.exceptionNote) &&
    receipt.exceptionNote === current.exceptionNote &&
    receipt.exceptionNote === String(payload.exceptionNote ?? "").trim() &&
    read.batches.some(batch => batch.id === current.batchId && batch.status === "exception");
}
