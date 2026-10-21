import assert from "node:assert/strict";
import test from "node:test";
import {
  isVerifiedBirModuleEvidence, readVerifiedBirModuleEvidence,
  type BirModuleReadScope, type VerifiedBirModuleEvidence,
} from "@/lib/bir-1604c-module-read";

const digest = "a".repeat(64);
const scope: BirModuleReadScope = {
  organizationId: 101, legalEntityId: 22, taxYear: 2026, sourceDigest: digest,
};
const blank = (moduleVersion: "7.0" | "7.4") => ({
  status: "not run" as const, moduleVersion, fileSha256: null,
  evidenceReference: null, validatedOn: null, independentlyReviewed: false,
  reportedAwaitingReview: false,
  note: "Fictional external validator source; no agency receipt",
});
const empty: VerifiedBirModuleEvidence = {
  organizationId: 101, legalEntityId: 22, taxYear: 2026,
  sourceDigest: digest, moduleV70: blank("7.0"), moduleV74: blank("7.4"),
  agencyAccepted: false,
};
const json = (body: unknown, status = 200): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

test("BIR 1604-C module: genuine verified not-run is accepted only with the selected identity", async () => {
  assert.equal(isVerifiedBirModuleEvidence(empty, scope), true);
  assert.deepEqual(await readVerifiedBirModuleEvidence(scope, json(empty)), empty);
  const checked = {
    ...empty, moduleV74: {
      ...blank("7.4"), status: "yes", fileSha256: "b".repeat(64),
      independentlyReviewed: true, evidenceReference: "FICTIONAL-REVIEW", validatedOn: "2026-10-20",
    },
  };
  assert.equal(isVerifiedBirModuleEvidence(checked, scope), true);
});

test("BIR module: non-OK and malformed JSON never display as not run", async () => {
  await assert.rejects(readVerifiedBirModuleEvidence(scope, json(empty, 404)), /unavailable/);
  const broken = (async () => new Response("{broken", { status: 200 })) as typeof fetch;
  await assert.rejects(readVerifiedBirModuleEvidence(scope, broken), /malformed JSON/);
});

test("BIR module: missing fields and wrong organization/legal employer/year/digest reject", async () => {
  for (const body of [
    {}, { ...empty, moduleV70: undefined }, { ...empty, organizationId: 999 },
    { ...empty, legalEntityId: 999 }, { ...empty, taxYear: 2025 },
    { ...empty, sourceDigest: "c".repeat(64) }, { ...empty, agencyAccepted: true },
    { ...empty, moduleV70: { ...blank("7.0"), status: "yes" } },
    { ...empty, moduleV70: { ...blank("7.0"), moduleVersion: "7.4" } },
    { ...empty, moduleV74: { ...blank("7.4"), reportedAwaitingReview: undefined } },
  ]) {
    assert.equal(isVerifiedBirModuleEvidence(body, scope), false);
    await assert.rejects(readVerifiedBirModuleEvidence(scope, json(body)), /incomplete, stale or belongs/);
  }
});

test("BIR module: Retry refetches and only displays later verified evidence", async () => {
  let attempts = 0;
  const fetcher = (async () => new Response(
    ++attempts === 1 ? "{invalid" : JSON.stringify(empty),
  )) as typeof fetch;
  await assert.rejects(readVerifiedBirModuleEvidence(scope, fetcher));
  assert.deepEqual(await readVerifiedBirModuleEvidence(scope, fetcher), empty);
  assert.equal(attempts, 2);
});
