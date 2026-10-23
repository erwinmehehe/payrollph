import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { confirmsStoredPaymentProof, parseVerifiedPaymentProof, readVerifiedPaymentProof } from "../src/lib/statutory-payment-proof-read";
const row = { id: 10, batchId: 22, fileName: "receipt.pdf", mimeType: "application/pdf",
  byteSize: 1234, fileSha256: "a".repeat(64), status: "active" as const, replacementReason: null,
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
test("POST 201 cannot confirm receipt without a matching verified refresh", () => {
  const uploaded = { id: row.id, fileSha256: row.fileSha256 };
  assert.equal(confirmsStoredPaymentProof(proof, 41, 22, uploaded), true);
  assert.equal(confirmsStoredPaymentProof(null, 41, 22, uploaded), false);
  assert.equal(confirmsStoredPaymentProof(proof, 42, 22, uploaded), false);
  assert.equal(confirmsStoredPaymentProof(proof, 41, 23, uploaded), false);
  assert.equal(confirmsStoredPaymentProof(proof, 41, 22, { ...uploaded, id: 99 }), false);
  assert.equal(confirmsStoredPaymentProof(proof, 41, 22, { ...uploaded, fileSha256: "b".repeat(64) }), false);
  assert.equal(confirmsStoredPaymentProof({ ...proof, evidence: [] }, 41, 22, uploaded), false);
  assert.equal(confirmsStoredPaymentProof({ ...proof, active: null }, 41, 22, uploaded), false);
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
  assert.match(ui, /const refreshed = await reloadWithOutcome\(\)/);
  assert.match(ui, /confirmsStoredPaymentProof\(refreshed\?\.data/);
  assert.match(api, /organizationId,\s+batchId,\s+evidence: rows/);
  assert.match(api, /const \[ownedBatch\] = await db\.select/);
  assert.match(api, /if \(!ownedBatch\) return Response\.json\(\{ error: "Remittance batch not found\." \}, \{ status: 404 \}\)/);
});

test("retired scopes suppress upload results and uncertain HTTP/transport outcomes force scoped reads", () => {
  const ui = readFileSync("src/components/workspace/statutory-payment-proof.tsx", "utf8");
  assert.match(ui, /const body = await response\.json\(\)\.catch\(\(\) => \(\{\}\)\);\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*if \(!isCurrent\(\)\) return;/,
    "A late POST response must not affect a retired employer view");
  assert.match(ui, /response\.status !== 201[\s\S]*?const refreshed = await reloadWithOutcome\(\);\s*if \(!isCurrent\(\)\) return;/,
    "Unexpected 2xx evidence must reload the source before another upload");
  assert.match(ui,
    /\} catch \(error\) \{\s*if \(!isCurrent\(\)\) return;[\s\S]*?const refreshed = await reloadWithOutcome\(\);\s*if \(!isCurrent\(\)\) return;[\s\S]*?notify\(/,
    "A late rejected upload must re-read evidence and cannot notify a retired employer");
  assert.match(ui, /Upload status cannot be confirmed\. Retry payment proof before another upload\./,
    "Transport or server-response uncertainty must never be presented as a confirmed failed upload");
  assert.match(ui, /\} finally \{\s*if \(isCurrent\(\)\) setBusy\(false\);/,
    "A retired upload must not change the active view's busy state");
});
