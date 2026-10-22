/**
 * Pure, employer/legal-entity/year scoped BIR 1604-C desktop module evidence
 * read. "Not run" is a real verified status, never the fallback for a failed
 * GET or a missing module result.
 */
export type VerifiedBirModuleReview = {
  status: "yes" | "no" | "not run";
  moduleVersion: "7.0" | "7.4";
  fileSha256: string | null;
  evidenceReference: string | null;
  validatedOn: string | null;
  independentlyReviewed: boolean;
  reportedAwaitingReview: boolean;
  note: string;
};
export type VerifiedBirModuleEvidence = {
  organizationId: number; legalEntityId: number; taxYear: number;
  moduleV70: VerifiedBirModuleReview; moduleV74: VerifiedBirModuleReview;
  sourceDigest: string; agencyAccepted: false;
  evidenceReceipts: Array<{
    id: number; action: "observe" | "review"; sourceDigest: string;
    observationId: number | null; moduleVersion: "7.0" | "7.4" | null;
    fileSha256: string;
  }>;
};
export type BirModuleReadScope = {
  organizationId: number; legalEntityId: number; taxYear: number; sourceDigest: string | null;
};
const record = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === "object" && !Array.isArray(x);
const id = (x: unknown) => typeof x === "number" && Number.isSafeInteger(x) && x > 0;
const hex = (x: unknown): x is string =>
  typeof x === "string" && /^[0-9a-f]{64}$/i.test(x);
const text = (x: unknown) => typeof x === "string" && x.trim().length > 0;
function calendarDay(x: unknown) {
  if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
  const ms = Date.parse(x + "T00:00:00Z");
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === x;
}
function validModule(value: unknown, version: "7.0" | "7.4"): value is VerifiedBirModuleReview {
  if (!record(value) || value.moduleVersion !== version ||
      !["yes", "no", "not run"].includes(String(value.status)) ||
      typeof value.reportedAwaitingReview !== "boolean" ||
      typeof value.independentlyReviewed !== "boolean" ||
      !text(value.note) ||
      !(value.fileSha256 === null || hex(value.fileSha256)) ||
      !(value.evidenceReference === null || text(value.evidenceReference)) ||
      !(value.validatedOn === null || calendarDay(value.validatedOn))) return false;
  if (value.status === "not run") {
    return value.independentlyReviewed === false && value.fileSha256 === null &&
      value.evidenceReference === null && value.validatedOn === null;
  }
  return value.independentlyReviewed === true && hex(value.fileSha256) &&
    text(value.evidenceReference) && calendarDay(value.validatedOn);
}
export function isVerifiedBirModuleEvidence(
  value: unknown, scope: BirModuleReadScope,
): value is VerifiedBirModuleEvidence {
  return id(scope.organizationId) && id(scope.legalEntityId) &&
    Number.isSafeInteger(scope.taxYear) && scope.taxYear >= 2018 && scope.taxYear <= 2100 &&
    record(value) && value.organizationId === scope.organizationId &&
    value.legalEntityId === scope.legalEntityId && value.taxYear === scope.taxYear &&
    hex(value.sourceDigest) &&
    (scope.sourceDigest === null || value.sourceDigest === scope.sourceDigest) &&
    value.agencyAccepted === false &&
    validModule(value.moduleV70, "7.0") && validModule(value.moduleV74, "7.4") &&
    Array.isArray(value.evidenceReceipts) && value.evidenceReceipts.length <= 300 &&
    value.evidenceReceipts.every((receipt: unknown) =>
      record(receipt) && id(receipt.id) &&
      receipt.sourceDigest === value.sourceDigest && hex(receipt.fileSha256) &&
      ((receipt.action === "observe" && receipt.observationId === null &&
        (receipt.moduleVersion === "7.0" || receipt.moduleVersion === "7.4")) ||
       (receipt.action === "review" && id(receipt.observationId) &&
        receipt.moduleVersion === null))) &&
    new Set((value.evidenceReceipts as Array<{id: number}>).map((row) => row.id)).size ===
      value.evidenceReceipts.length;
}
export async function readVerifiedBirModuleEvidence(
  scope: BirModuleReadScope, fetcher: typeof fetch = fetch, signal?: AbortSignal,
): Promise<VerifiedBirModuleEvidence> {
  if (!id(scope.organizationId) || !id(scope.legalEntityId) ||
      !Number.isSafeInteger(scope.taxYear)) throw Error("BIR module status unavailable: invalid employer scope.");
  const url = "/api/bir/annual-employer/module-evidence?organizationId=" +
    scope.organizationId + "&legalEntityId=" + scope.legalEntityId + "&taxYear=" + scope.taxYear;
  const response = await fetcher(url, { cache: "no-store", signal });
  if (!response.ok) throw Error("BIR desktop validation evidence unavailable. Retry.");
  let value: unknown;
  try { value = await response.json(); }
  catch { throw Error("BIR desktop evidence returned malformed JSON. Retry."); }
  if (!isVerifiedBirModuleEvidence(value, scope)) {
    throw Error("BIR validation evidence is incomplete, stale or belongs to another employer/year. Retry.");
  }
  return value;
}

// Confirm the specific synthetic audit receipt, not just a stale status envelope.
// This is a UI gate. The server remains authoritative for employee data and approvals.
export function confirmedBirModuleMutation(
  mode: "observe" | "review", receipt: unknown,
  refreshed: VerifiedBirModuleEvidence, scope: BirModuleReadScope,
  expected: { observationId?: number; moduleVersion?: "7.0" | "7.4"; fileSha256?: string },
): boolean {
  if (!record(receipt) || !isVerifiedBirModuleEvidence(refreshed, scope)) return false;
  const receiptId = mode === "observe" ? receipt.observationId : receipt.reviewId;
  if (!id(receiptId)) return false;
  const saved = refreshed.evidenceReceipts.find((item) => item.id === receiptId);
  if (!saved || saved.action !== mode || saved.sourceDigest !== refreshed.sourceDigest)
    return false;
  if (mode === "observe") return saved.moduleVersion === expected.moduleVersion &&
    saved.fileSha256 === expected.fileSha256;
  const actual = saved.observationId === null ? null :
    refreshed.evidenceReceipts.find((item) => item.id === saved.observationId);
  if (!actual || actual.action !== "observe" || saved.fileSha256 !== actual.fileSha256 ||
      actual.id !== expected.observationId ||
      receipt.moduleVersion !== actual.moduleVersion) return false;
  const reviewState = actual.moduleVersion === "7.0" ? refreshed.moduleV70 : refreshed.moduleV74;
  return reviewState.status === receipt.status &&
    reviewState.independentlyReviewed === receipt.independentlyReviewed &&
    reviewState.fileSha256 === receipt.fileSha256 &&
    reviewState.evidenceReference === receipt.evidenceReference &&
    reviewState.validatedOn === receipt.validatedOn;
}
