import assert from "node:assert/strict";
import test from "node:test";
import {
  isVerifiedPaymentProofRead, readVerifiedPaymentProof,
  type VerifiedPaymentProofRead,
} from "@/lib/statutory-payment-proof-read";

const employer = 101;
const batch = 303;
const empty: VerifiedPaymentProofRead = {
  organizationId: employer, batchId: batch, evidence: [], active: null,
};
const row = {
  id: 601, batchId: batch, fileName: "fictional-agency-receipt.pdf",
  mimeType: "application/pdf", byteSize: 1024, fileSha256: "a".repeat(64),
  status: "active" as const, replacementReason: null,
  uploadedByName: "Fictional Payroll Operator",
  uploadedAt: "2026-01-15T10:00:00.000Z", supersededAt: null,
};
const json = (body: unknown, status = 200): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

test("payment proof: verified-empty is distinct from an unavailable response", async () => {
  assert.equal(isVerifiedPaymentProofRead(empty, employer, batch), true);
  assert.deepEqual(await readVerifiedPaymentProof(employer, batch, json(empty)), empty);
  const withProof = { ...empty, evidence: [row], active: row };
  assert.equal(isVerifiedPaymentProofRead(withProof, employer, batch), true);
  assert.equal((await readVerifiedPaymentProof(employer, batch, json(withProof))).active?.id, row.id);
});

test("payment proof: non-OK and malformed JSON do not become empty receipt lists", async () => {
  await assert.rejects(readVerifiedPaymentProof(employer, batch, json(empty, 403)), /unavailable/);
  const malformed = (async () => new Response("{bad json", { status: 200 })) as typeof fetch;
  await assert.rejects(readVerifiedPaymentProof(employer, batch, malformed), /malformed JSON/);
});

test("payment proof: missing fields, foreign employer or batch cannot certify success", async () => {
  for (const invalid of [
    {}, { ...empty, evidence: undefined }, { ...empty, active: undefined },
    { ...empty, organizationId: employer + 1 },
    { ...empty, batchId: batch + 1 },
    { ...empty, evidence: [row], active: null },
    { ...empty, evidence: [{ ...row, batchId: batch + 1 }], active: row },
    { ...empty, evidence: [row, row], active: row },
    { ...empty, evidence: [row], active: { ...row, fileName: "different.pdf" } },
    { ...empty, evidence: [{ ...row, fileSha256: "" }], active: null },
  ]) {
    assert.equal(isVerifiedPaymentProofRead(invalid, employer, batch), false);
    await assert.rejects(readVerifiedPaymentProof(employer, batch, json(invalid)), /incomplete or for another/);
  }
});

test("payment proof: retry performs a fresh GET and only the verified second read succeeds", async () => {
  let calls = 0;
  const retryFetcher = (async () => {
    calls++;
    return calls === 1
      ? new Response(JSON.stringify({ ...empty, evidence: undefined }))
      : new Response(JSON.stringify(empty));
  }) as typeof fetch;
  await assert.rejects(readVerifiedPaymentProof(employer, batch, retryFetcher));
  assert.deepEqual(await readVerifiedPaymentProof(employer, batch, retryFetcher), empty);
  assert.equal(calls, 2);
});
