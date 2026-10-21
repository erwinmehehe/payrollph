import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseRemittanceMonthCloseRead } from "../src/lib/remittance-month-close-read";

const digest = (char: string) => char.repeat(64);
const validRead = () => ({
  organizationId: 17,
  applicableMonth: "2026-09",
  legalEntity: { id: 88, code: "FICT", displayName: "Fictional employer" },
  certificationRole: "independent-reviewer",
  evaluation: {
    ready: false, blockers: ["SSS posting evidence missing."],
    snapshotHash: digest("a"), agencyCount: 1, memberCount: 1,
    batches: [{ id: 101, agency: "SSS", status: "pending", snapshotHash: digest("b"), pendingPostingCount: 1, exceptionCount: 0 }],
    members: [{ batchId: 101, employeeId: 201, postingStatus: "pending" }],
    paymentEvidence: [], corrections: [], issueCases: [],
  },
  closure: null,
  certificationHistory: [],
  certificationValid: false,
});

const parse = (value: unknown, entity: number | null = 88) =>
  parseRemittanceMonthCloseRead(value, 17, entity, "2026-09");

test("complete blocked and ready responses are distinguishable from unknown", () => {
  const blocked = validRead();
  assert.equal(parse(blocked)?.evaluation.ready, false);
  const ready = { ...blocked, evaluation: { ...blocked.evaluation, blockers: [], ready: true } };
  assert.equal(parse(ready)?.evaluation.ready, true);
  assert.equal(parse(ready, null)?.legalEntity.id, 88);
  assert.equal(parse({}), null);
  assert.equal(parse({ ...ready, evaluation: undefined }), null);
});

test("failed/malformed successes cannot display 0, ready or certification for a foreign scope", () => {
  const valid = validRead();
  const invalid: unknown[] = [
    { ...valid, organizationId: 18 },
    { ...valid, applicableMonth: "2026-08" },
    { ...valid, legalEntity: { ...valid.legalEntity, id: 89 } },
    { ...valid, legalEntity: undefined },
    { ...valid, certificationRole: "owner" },
    { ...valid, evaluation: { ...valid.evaluation, ready: true } },
    { ...valid, evaluation: { ...valid.evaluation, blockers: [], ready: false } },
    { ...valid, evaluation: { ...valid.evaluation, agencyCount: 0 } },
    { ...valid, evaluation: { ...valid.evaluation, memberCount: 0 } },
    { ...valid, evaluation: { ...valid.evaluation, memberCount: -1 } },
    { ...valid, evaluation: { ...valid.evaluation, snapshotHash: "missing" } },
    { ...valid, evaluation: { ...valid.evaluation, members: undefined } },
    { ...valid, evaluation: { ...valid.evaluation, batches: [{ ...valid.evaluation.batches[0], pendingPostingCount: "0" }] } },
    { ...valid, evaluation: { ...valid.evaluation, batches: [valid.evaluation.batches[0], valid.evaluation.batches[0]], agencyCount: 2 } },
    { ...valid, evaluation: { ...valid.evaluation, members: [{ batchId: 102, employeeId: 201, postingStatus: "posted" }] } },
    { ...valid, certificationHistory: undefined },
    { ...valid, certificationValid: true },
    { closure: null, evaluation: valid.evaluation, certificationValid: true }, // short POST response, not GET
  ];
  for (const input of invalid) assert.equal(parse(input), null);
  assert.equal(parseRemittanceMonthCloseRead(valid, 18, 88, "2026-09"), null);
  assert.equal(parseRemittanceMonthCloseRead(valid, 17, 88, "2026-08"), null);
});

test("claimed certification requires matched immutable closure, source scope and history", () => {
  const current = validRead();
  const ready = { ...current, evaluation: { ...current.evaluation, ready: true, blockers: [] } };
  const closure = {
    id: 55, organizationId: 17, legalEntityId: 88,
    applicableMonth: "2026-09", status: "certified",
    certifiedByName: "Fictional independent reviewer",
    certifiedAt: "2026-10-19T10:00:00.000Z", snapshotHash: digest("a"),
  };
  const certified = { ...ready, closure, certificationHistory: [closure], certificationValid: true };
  assert.equal(parse(certified)?.certificationValid, true);
  assert.equal(parse({ ...certified, closure: { ...closure, snapshotHash: digest("c") } }), null);
  assert.equal(parse({ ...certified, closure: { ...closure, organizationId: 18 } }), null);
  assert.equal(parse({ ...certified, certificationHistory: [{ ...closure, legalEntityId: 89 }] }), null);
  assert.equal(parse({ ...certified, certificationHistory: [closure, closure] }), null);
  assert.equal(parse({ ...certified, certificationValid: false }), null);
  assert.equal(parse({ ...certified, closure: null }), null);
  const stale = { ...certified, evaluation: { ...ready.evaluation, snapshotHash: digest("d") }, certificationValid: false };
  assert.equal(parse(stale)?.certificationValid, false);
});

test("the client refuses incomplete read and re-reads after write before showing success", () => {
  const ui = readFileSync("src/components/workspace/statutory-remittance-month-close.tsx", "utf8");
  const api = readFileSync("src/app/api/compliance/remittance-month-close/route.ts", "utf8");
  assert.match(api, /\.\.\.publicResult,\s*organizationId,\s*applicableMonth,/);
  assert.match(ui, /setState\(null\)/);
  assert.match(ui, /parseRemittanceMonthCloseRead\(/);
  assert.match(ui, /if \(loading\)/);
  assert.match(ui, /if \(!state\)/);
  assert.match(ui, /Certification status unavailable/);
  assert.match(ui, /const verified = await load\(\)/);
  assert.match(ui, /verified\?\.certificationValid && verified\.closure\?\.snapshotHash === requestedSnapshot/);
  assert.doesNotMatch(ui, /setState\(body as CloseState\)/);
});


test("new method-level tenant proof survives CI/source drift (GET and POST)", () => {
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const path = "src/app/api/compliance/remittance-month-close/route.ts";
  const record = manifest.allApiRouteFiles[path];
  assert.equal(manifest.metrics.methods, 493, "493 actual methods including the three inherited #641 handlers");
  // Pin the DL-01 ledger exactly; retain the endpoint-specific HTTP proofs below.
  assert.equal(manifest.metrics.coveredAfter, 94, "Merged receipt POST plus DL-01 GET receipts; all counts provisional");
  assert.equal(manifest.metrics.publicByDesign, 10, "Eight inherited public dispositions plus two DL-01 fixed templates");
  assert.equal(manifest.metrics.gap, 389, "389 other methods still need own/victim evidence");
  assert.equal(manifest.metrics.coveredAfter + manifest.metrics.publicByDesign + manifest.metrics.gap, 493);
  const harnessLines = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8").split("\n");
  const readLine = (number: number) => {
    assert.ok(Number.isInteger(number) && number > 0 && number <= harnessLines.length);
    return harnessLines[number - 1];
  };
  for (const name of ["GET", "POST"]) {
    const method = record.methods.find((candidate: { name: string }) => candidate.name === name);
    assert.equal(method?.status, "COVERED", name + " must not borrow an anonymous 403");
    assert.equal(method?.testedBy?.file, "scripts/qa/tenant-second-pass-http.mjs");
    const own = readLine(method.testedBy.ownPositiveLine);
    const foreign = readLine(method.testedBy.foreignDenialLine);
    const victimUnchanged = readLine(method.testedBy.unchangedDbLine);
    assert.ok(own.includes("/api/compliance/remittance-month-close") && own.includes("), 200,"),
      name + ": actual own employer positive 200 required");
    assert.ok(foreign.includes("/api/compliance/remittance-month-close") &&
      foreign.includes("victim.id") && foreign.includes("), 403,"),
      name + ": real victim employer exact 403 required");
    assert.match(victimUnchanged, /assert\.deepEqual\(victimClosuresAfter, victimClosuresBefore/);
    if (name === "POST") {
      assert.ok(own.includes('method: "POST"') && foreign.includes('method: "POST"'));
      assert.ok(harnessLines.some(line => line.includes("persistedClosure?.id, ownMonthClosePost.json.closure.id")),
        "Own POST must persist actual certifying record, not just succeed with a stub");
    }
  }
  assert.ok(harnessLines.some(line => line.includes('await verifyRemittanceMonthCloseTenantProof(f);')),
    "Method-level test must be executed by existing real-HTTP disposable PG16 job");
  assert.ok(harnessLines.some(line => line.includes('period = "2026-09"')));
  assert.ok(harnessLines.some(line => line.includes('status: "reconciled"')));
  assert.ok(harnessLines.some(line => line.includes('fileSha256: createHash("sha256")')));
  assert.ok(harnessLines.some(line => line.includes('assert.deepEqual(victimBatchesAfter, victimBatchesBefore')));
  assert.ok(harnessLines.some(line => line.includes('assert.deepEqual(victimEvidenceAfter, victimEvidenceBefore')));
});


test("actual server active payment-proof shape parses without nonexistent status field", () => {
  const original = validRead();
  const proof = {
    id: 303, batchId: 101, fileName: "fictional-payment-proof.pdf",
    fileSha256: digest("c"), byteSize: 82,
    uploadedByName: "Fictional independent treasury reviewer",
    uploadedAt: "2026-10-19T08:00:00.000Z",
  };
  const ready = {
    ...original,
    evaluation: { ...original.evaluation, ready: true, blockers: [], paymentEvidence: [proof] },
  };
  assert.equal(parse(ready)?.evaluation.ready, true,
    "Valid active proof is emitted without status by evaluateRemittanceMonthClose");
  const invalid = [
    { ...proof, batchId: 202 },
    { ...proof, fileSha256: "" },
    { ...proof, byteSize: 0 },
    { ...proof, uploadedByName: "" },
    { ...proof, uploadedAt: "not-a-date" },
  ];
  for (const broken of invalid) {
    assert.equal(parse({
      ...ready, evaluation: { ...ready.evaluation, paymentEvidence: [broken] },
    }), null, "Incomplete or foreign active proof must fail closed");
  }
  const evaluator = readFileSync("src/lib/statutory-remittance-close.ts", "utf8");
  assert.match(evaluator, /paymentEvidence: activePaymentEvidence/);
  assert.match(evaluator, /uploadedByName: evidence.uploadedByName/);
  assert.match(evaluator, /uploadedAt: String\(evidence.uploadedAt\)/);
});
