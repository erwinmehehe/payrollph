import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  compensationEvidenceFromDefinition,
  compensationReviewFingerprint,
  freezeCompensationReview,
  type HcmCompensationReview,
} from "../src/lib/hcm-compensation-business-process";

const recommendation: HcmCompensationReview = {
  organizationId: 8,
  proposalId: 22,
  employeeId: 141,
  employeeOrgUnitId: 13,
  cycleId: 44,
  cycleStatus: "active",
  cycleEffectiveDate: "2026-11-01",
  cycleBudgetPool: "200000.00",
  bandId: 7,
  bandMinimumAnnual: "400000.00",
  bandMidpointAnnual: "550000.00",
  bandMaximumAnnual: "800000.00",
  currentAnnual: "500000.00",
  proposedAnnual: "530000.00",
  reason: "Approved salary-cycle merit proposal",
  workerEffectiveChangeId: null,
};

test("compensation governance freezes pay, scope, salary band, cycle and budget", () => {
  const original = compensationReviewFingerprint(recommendation);
  assert.match(original, /^[a-f0-9]{64}$/);
  const changes: Partial<HcmCompensationReview>[] = [
    { organizationId: 10 },
    { employeeId: 142 },
    { employeeOrgUnitId: 14 },
    { cycleStatus: "closed" },
    { cycleBudgetPool: "100000.00" },
    { cycleEffectiveDate: "2026-12-01" },
    { bandMinimumAnnual: "420000.00" },
    { bandMaximumAnnual: "700000.00" },
    { currentAnnual: "510000.00" },
    { proposedAnnual: "530001.00" },
    { reason: "Different decision" },
    { workerEffectiveChangeId: 2 },
  ];
  for (const update of changes) {
    assert.notEqual(compensationReviewFingerprint({ ...recommendation, ...update }), original, JSON.stringify(update));
  }
  assert.throws(() => compensationReviewFingerprint({ ...recommendation, proposalId: 0 }), /Invalid compensation/);
});

test("compensation source snapshots are structurally validated", () => {
  const evidence = freezeCompensationReview(recommendation);
  assert.deepEqual(compensationEvidenceFromDefinition({ sourceEvidence: evidence }), evidence);
  assert.equal(compensationEvidenceFromDefinition({ sourceEvidence: { ...evidence, proposalId: "22" } }), null);
  assert.equal(compensationEvidenceFromDefinition({ sourceEvidence: { ...evidence, fingerprint: "wrong" } }), null);
  assert.equal(compensationEvidenceFromDefinition({ sourceEvidence: { ...evidence, employeeId: -1 } }), null);
  assert.equal(compensationEvidenceFromDefinition({}), null);
});

test("pay approvals require independent HCM review before salary revision", () => {
  const api = readFileSync("src/app/api/compensation/route.ts", "utf8");
  const engine = readFileSync("src/lib/hcm-business-process.ts", "utf8");
  const post = api.indexOf('if (entityType === "proposal")');
  const patch = api.indexOf("export async function PATCH");
  const approval = api.indexOf('const businessProcess = await findHcmBusinessProcessForSource(', patch);
  const revision = api.indexOf('tx.insert(employeePayRevisions)', approval);
  const apply = api.indexOf('status: "applied", updatedAt: new Date()', revision);
  assert.ok(post > 0 && patch > post && approval > patch && revision > approval && apply > revision);
  assert.match(api.slice(post, patch), /processType: "compensation_change"/);
  assert.match(api.slice(post, patch), /sourceType: "compensation_proposal"/);
  assert.match(api.slice(post, patch), /db.transaction\(async \(tx\) =>/);
  assert.match(api.slice(approval, revision), /businessProcess.status !== "approved"/);
  assert.match(api.slice(approval, revision), /compensationReviewFingerprint/);
  assert.match(api.slice(revision), /eq\(hcmBusinessProcessInstances.status, "approved"\)/);
  assert.match(engine, /instance.sourceType === "compensation_proposal"/);
  assert.match(engine, /status: "declined"/);
});

test("HCM review does not directly alter pay profiles, run payroll or release funds", () => {
  const engine = readFileSync("src/lib/hcm-business-process.ts", "utf8");
  const start = engine.indexOf('if (instance.sourceType === "compensation_proposal")');
  const end = engine.indexOf('if (instance.sourceType !== "worker_effective_change")', start);
  const handler = engine.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(handler, /sourceFinalized: false/);
  assert.doesNotMatch(handler, /employeePayRevisions|payrollRuns|payout|releasePayroll|applyScheduledCompensation/);
});

test("compensation UI exposes HCM review and disables premature pay approval", () => {
  const ui = readFileSync("src/components/compensation-panel.tsx", "utf8");
  assert.match(ui, /proposal.hcmReview\?\.status === "approved"/);
  assert.match(ui, /HCM review:/);
  assert.match(ui, /Pay cannot change until/);
});
