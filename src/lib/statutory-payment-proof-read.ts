/**
 * Client-only proof-of-payment read contract. A missing or foreign evidence
 * collection is never treated as proof that no agency receipt was recorded.
 * Mutation authorization remains server-side.
 */
export type VerifiedPaymentProofRow = {
  id: number;
  batchId: number;
  fileName: string;
  mimeType: string;
  byteSize: number;
  fileSha256: string;
  status: "active" | "superseded";
  replacementReason: string | null;
  uploadedByName: string;
  uploadedAt: string;
  supersededAt: string | null;
};
export type VerifiedPaymentProofRead = {
  organizationId: number;
  batchId: number;
  evidence: VerifiedPaymentProofRow[];
  active: VerifiedPaymentProofRow | null;
};
const obj = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === "object" && !Array.isArray(x);
const id = (x: unknown): x is number =>
  typeof x === "number" && Number.isSafeInteger(x) && x > 0;
const text = (x: unknown): x is string =>
  typeof x === "string" && x.trim().length > 0;
const date = (x: unknown): x is string =>
  typeof x === "string" && Number.isFinite(Date.parse(x));
function validRow(value: unknown, batchId: number): value is VerifiedPaymentProofRow {
  if (!obj(value) || !id(value.id) || value.batchId !== batchId ||
      !text(value.fileName) ||
      !["application/pdf", "image/jpeg", "image/png"].includes(String(value.mimeType)) ||
      !id(value.byteSize) || value.byteSize > 2 * 1024 * 1024 ||
      typeof value.fileSha256 !== "string" || !/^[0-9a-f]{64}$/i.test(value.fileSha256) ||
      !["active", "superseded"].includes(String(value.status)) ||
      !(value.replacementReason === null || typeof value.replacementReason === "string") ||
      !text(value.uploadedByName) || !date(value.uploadedAt) ||
      !(value.supersededAt === null || date(value.supersededAt))) return false;
  return true;
}
/** Verified empty: evidence=[], active=null, but only with matching identity. */
export function isVerifiedPaymentProofRead(
  value: unknown, organizationId: number, batchId: number,
): value is VerifiedPaymentProofRead {
  if (!id(organizationId) || !id(batchId) || !obj(value) ||
      value.organizationId !== organizationId || value.batchId !== batchId ||
      !Array.isArray(value.evidence) || value.evidence.length > 500 ||
      !value.evidence.every((row: unknown) => validRow(row, batchId))) return false;
  const rows = value.evidence as VerifiedPaymentProofRow[];
  if (new Set(rows.map((row) => row.id)).size !== rows.length) return false;
  const active = rows.filter((row) => row.status === "active");
  if (active.length > 1) return false;
  if (value.active === null) return active.length === 0;
  return validRow(value.active, batchId) && active.length === 1 &&
    value.active.id === active[0].id &&
    JSON.stringify(value.active) === JSON.stringify(active[0]);
}
export async function readVerifiedPaymentProof(
  organizationId: number, batchId: number,
  fetcher: typeof fetch = fetch, signal?: AbortSignal,
): Promise<VerifiedPaymentProofRead> {
  if (!id(organizationId) || !id(batchId)) {
    throw new Error("Payment proof unavailable: select a valid employer and batch.");
  }
  const response = await fetcher(
    "/api/compliance/statutory-remittances/payment-evidence?organizationId=" +
      organizationId + "&batchId=" + batchId,
    { cache: "no-store", signal },
  );
  if (!response.ok) throw new Error("Payment proof unavailable. Retry the evidence read.");
  let payload: unknown;
  try { payload = await response.json(); }
  catch { throw new Error("Payment proof returned malformed JSON. Retry."); }
  if (!isVerifiedPaymentProofRead(payload, organizationId, batchId)) {
    throw new Error("Payment proof response incomplete or for another employer/batch. Retry.");
  }
  return payload;
}
