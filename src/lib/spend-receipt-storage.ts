import { createHash } from "node:crypto";
import { documentStorageConfig, signedDocumentObjectUrl } from "./document-object-storage";
import { receiptObjectIdentityMatches } from "./spend-payroll-reimbursement";

/** Private bytes must match the scanned/uploaded receipt before use or download. */
export async function readVerifiedSpendReceipt(input: {
  key: string; organizationId: number; employeeId: number; sha256: string; byteSize: number;
}, fetchImpl: typeof fetch = fetch) {
  if (!receiptObjectIdentityMatches(input.key, input.organizationId, input.employeeId) ||
    !/^[a-f0-9]{64}$/.test(input.sha256) || !Number.isSafeInteger(input.byteSize) ||
    input.byteSize < 1 || input.byteSize > 5242880) throw new Error("RECEIPT_IDENTITY_INVALID");
  const url = signedDocumentObjectUrl(input.key, "GET", documentStorageConfig());
  const response = await fetchImpl(url, { method: "GET", cache: "no-store", redirect: "error",
    signal: AbortSignal.timeout(20000) });
  if (!response.ok || !response.body) throw new Error("RECEIPT_READ_UNAVAILABLE");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > input.byteSize) throw new Error("RECEIPT_SIZE_MISMATCH");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = Buffer.concat(chunks);
  if (bytes.byteLength !== input.byteSize || createHash("sha256").update(bytes).digest("hex") !== input.sha256) {
    throw new Error("RECEIPT_HASH_MISMATCH");
  }
  return bytes;
}
