import assert from "node:assert/strict";
import test from "node:test";
import {
  birCandidateDownloadExists, birModuleEvidenceStatus, validateBirModuleObservation,
  type BirModuleAudit,
} from "../src/lib/bir-1604c-module-evidence";

const sourceDigest = "a".repeat(64);
const sha = "b".repeat(64);
function observations(outcome: "pass" | "fail" = "pass", moduleVersion = "7.0"): BirModuleAudit[] {
  return [{
    id: 1, action: "bir1604c.candidate.downloaded", actor: "user:1",
    metadata: { sourceDigest, fileSha256: sha },
  }, {
    id: 2, action: "bir1604c.validator.observed", actor: "user:1",
    metadata: {
      sourceDigest, fileSha256: sha, moduleVersion, outcome,
      validatedOn: "2026-10-12", evidenceReference: "private-bir-validator-log",
    },
  }];
}
function reviewed(outcome: "pass" | "fail" = "pass", version = "7.0"): BirModuleAudit[] {
  return [...observations(outcome, version), {
    id: 3, action: "bir1604c.validator.reviewed", actor: "user:2",
    metadata: { sourceDigest, fileSha256: sha,
      observationId: 2, decision: "confirmed", evidenceReference: "private-checker-record" },
  }];
}
test("matching, independently reviewed module result permits exactly yes/no for same bytes/version", () => {
  assert.equal(birModuleEvidenceStatus(reviewed(), sourceDigest).status, "yes");
  assert.equal(birModuleEvidenceStatus(reviewed("fail"), sourceDigest).status, "no");
  assert.equal(birModuleEvidenceStatus(reviewed(), sourceDigest, "7.4").status, "not run");
  assert.equal(birModuleEvidenceStatus(reviewed("pass", "7.4"), sourceDigest, "7.4").status, "yes");
});
test("unreviewed, same-actor or rejected observations cannot become official evidence", () => {
  assert.equal(birModuleEvidenceStatus(observations(), sourceDigest).status, "not run");
  assert.equal(birModuleEvidenceStatus(observations(), sourceDigest).reportedAwaitingReview, true);
  const self = reviewed();
  self[2].actor = "user:1";
  assert.equal(birModuleEvidenceStatus(self, sourceDigest).status, "not run");
  const rejected = reviewed();
  (rejected[2].metadata as Record<string, unknown>).decision = "rejected";
  assert.equal(birModuleEvidenceStatus(rejected, sourceDigest).status, "not run");
});
test("new DAT bytes or stale payroll source invalidate previously reviewed pass", () => {
  const audits = reviewed();
  audits.push({ id: 4, action: "bir1604c.candidate.downloaded", actor: "user:1",
    metadata: { sourceDigest, fileSha256: "c".repeat(64) } });
  assert.equal(birModuleEvidenceStatus(audits, sourceDigest).status, "not run");
  assert.equal(birModuleEvidenceStatus(reviewed(), "d".repeat(64)).status, "not run");
  assert.equal(birCandidateDownloadExists(reviewed(), sourceDigest, sha), true);
  assert.equal(birCandidateDownloadExists(reviewed(), sourceDigest, "c".repeat(64)), false);
});
test("fabricated observation, invalid date or missing private evidence is rejected", () => {
  const form = (observations()[1].metadata as Record<string, unknown>);
  assert.equal(validateBirModuleObservation(form)?.outcome, "pass");
  assert.equal(validateBirModuleObservation({ ...form, validatedOn: "2026-02-30" }), null);
  assert.equal(validateBirModuleObservation({ ...form, validatedOn: "2099-01-01" }), null);
  assert.equal(validateBirModuleObservation({ ...form, moduleVersion: "foo" }), null);
  assert.equal(validateBirModuleObservation({ ...form, evidenceReference: "x" }), null);
  assert.equal(validateBirModuleObservation({ ...form, fileSha256: "bad" }), null);
});
