export type EvidenceRow = {
  id: number; batchId: number; fileName: string; mimeType: string; byteSize: number;
  fileSha256: string; status: "active" | "superseded"; replacementReason: string | null;
  uploadedByName: string; uploadedAt: string; supersededAt: string | null;
};
export type VerifiedPaymentProof = {
  organizationId: number; batchId: number; evidence: EvidenceRow[]; active: EvidenceRow | null;
};
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const text = (v: unknown) => typeof v === "string" && v.trim().length > 0;
const optionalText = (v: unknown) => v === null || typeof v === "string";
function evidenceRow(v: unknown, batchId: number): v is EvidenceRow {
  return record(v) && id(v.id) && v.batchId === batchId &&
    text(v.fileName) &&
    ["application/pdf", "image/jpeg", "image/png"].includes(String(v.mimeType)) &&
    id(v.byteSize) && typeof v.fileSha256 === "string" &&
    /^[a-f0-9]{64}$/i.test(v.fileSha256) &&
    (v.status === "active" || v.status === "superseded") &&
    optionalText(v.replacementReason) && text(v.uploadedByName) &&
    text(v.uploadedAt) && optionalText(v.supersededAt);
}
/** Read proof cannot silently drop audit history, misbind a batch or invent "no proof". */
export function parseVerifiedPaymentProof(
  value: unknown, organizationId: number, batchId: number,
): VerifiedPaymentProof | null {
  if (!id(organizationId) || !id(batchId) || !record(value) ||
      value.organizationId !== organizationId || value.batchId !== batchId ||
      !Array.isArray(value.evidence) || !value.evidence.every(v => evidenceRow(v, batchId)) ||
      !(value.active === null || evidenceRow(value.active, batchId))) return null;
  const rows = value.evidence as EvidenceRow[];
  const active = rows.filter(v => v.status === "active");
  if (new Set(rows.map(v => v.id)).size !== rows.length || active.length > 1 ||
      (active.length === 0 ? value.active !== null :
        !record(value.active) || value.active.id !== active[0].id ||
        value.active.fileSha256 !== active[0].fileSha256)) return null;
  return value as VerifiedPaymentProof;
}
export async function readVerifiedPaymentProof(
  organizationId: number, batchId: number,
  fetcher: typeof fetch = fetch, signal?: AbortSignal,
): Promise<VerifiedPaymentProof> {
  if (!id(organizationId) || !id(batchId)) throw Error("Payment proof unavailable. Retry.");
  const response = await fetcher(
    "/api/compliance/statutory-remittances/payment-evidence?organizationId=" +
    organizationId + "&batchId=" + batchId, { cache: "no-store", signal });
  if (!response.ok) throw Error("Payment proof unavailable. Retry.");
  let value: unknown;
  try { value = await response.json(); }
  catch { throw Error("Payment proof unreadable. Retry."); }
  const verified = parseVerifiedPaymentProof(value, organizationId, batchId);
  if (!verified) throw Error("Payment proof incomplete or for a different employer/batch. Retry.");
  return verified;
}
