import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parseVerifiedPaymentProof, readVerifiedPaymentProof } from "../src/lib/statutory-payment-proof-read";
const row = { id: 10, batchId: 22, fileName: "receipt.pdf", mimeType: "application/pdf",
  byteSize: 1234, fileSha256: "a".repeat(64), status: "active", replacementReason: null,
  uploadedByName: "Test Operator", uploadedAt: "2026-10-20T00:00:00Z", supersededAt: null };
const proof = { organizationId: 41, batchId: 22, evidence: [row], active: row };
test("statutory proof binds exact employer/batch, rows, active and genuine empty", () => {
  assert.deepEqual(parseVerifiedPaymentProof(proof, 41, 22), proof);
  assert.deepEqual(parseVerifiedPaymentProof({ organizationId: 41, batchId: 22, evidence: [], active: null }, 41, 22)?.evidence, []);
  for (const v of [null, {}, { ...proof, organizationId: 42 }, { ...proof, batchId: 23 },
    { ...proof, evidence: undefined }, { ...proof, evidence: [row], active: null },
    { ...proof, evidence: [], active: row }, { ...proof, evidence: [{ ...row, batchId: 23 }] },
    { ...proof, evidence: [{ ...row, fileSha256: null }] }, { ...proof, evidence: [row, row] },
    { ...proof, active: { ...row, status: "superseded" } },
    { ...proof, active: { ...row, fileName: "another-receipt.pdf" } },
    { ...proof, active: { ...row, uploadedByName: "Different operator" } }])
    assert.equal(parseVerifiedPaymentProof(v, 41, 22), null);
});
test("statutory proof non-OK/JSON/foreign/partial always unavailable until successful retry", async () => {
  let status = 502, invalid = false, payload: unknown = proof, requests = 0;
  const fetcher = (async () => {requests++; return { ok: status === 200,
    json: async () => {if(invalid)throw SyntaxError("invalid");return payload;} } as Response;}) as typeof fetch;
  await assert.rejects(() => readVerifiedPaymentProof(41, 22, fetcher), /unavailable/);
  status = 200; invalid = true;
  await assert.rejects(() => readVerifiedPaymentProof(41, 22, fetcher), /unreadable/);
  invalid = false; payload = { ...proof, organizationId: 42 };
  await assert.rejects(() => readVerifiedPaymentProof(41, 22, fetcher), /different employer/);
  payload = { ...proof, evidence: undefined };
  await assert.rejects(() => readVerifiedPaymentProof(41, 22, fetcher), /incomplete/);
  payload = { organizationId: 41, batchId: 22, evidence: [], active: null };
  assert.deepEqual((await readVerifiedPaymentProof(41, 22, fetcher)).evidence, []);
  assert.equal(requests, 5);
});
test("proof uploader cannot act on an unverified read and explicitly offers retry", () => {
  const ui = readFileSync("src/components/workspace/statutory-payment-proof.tsx", "utf8");
  const api = readFileSync("src/app/api/compliance/statutory-remittances/payment-evidence/route.ts", "utf8");
  assert.match(ui, /if \(!proof\)/);
  assert.match(ui, /Retry payment proof/);
  assert.match(api, /organizationId,\s+batchId,\s+evidence: rows/);
  assert.match(api, /const \[ownedBatch\] = await db\.select/);
  assert.match(api, /if \(!ownedBatch\) return Response\.json\(\{ error: "Remittance batch not found\." \}, \{ status: 404 \}\)/);
});
