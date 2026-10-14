import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const path = "qa-artifacts/nine-stage-connected-report.json";
const required = process.env.NINE_STAGE_EVIDENCE_REQUIRED === "true";
const stages = ["Hire","Onboard","Schedule","Clock In","Approve Time","Run Payroll",
  "Review","Release Payroll Records","Prepare Filing Evidence"];

function isAccepted(r) {
  return Boolean(r && r.result === "PASS" && Array.isArray(r.stages)
    && r.stages.length === stages.length
    && r.stages.every((s, index) => s?.name === stages[index] && s.status === "PASS"));
}

test("missing or incomplete connected evidence is never acceptance", () => {
  const passes = stages.map(name => ({ name, status: "PASS" }));
  assert.equal(isAccepted(null), false);
  assert.equal(isAccepted({ result: "PASS", stages: [] }), false);
  assert.equal(isAccepted({ result: "FAIL", stages: passes }), false);
  assert.equal(isAccepted({ result: "PASS", stages: passes.map((s, i) =>
    i === 5 ? { ...s, status: "FAIL" } : s) }), false);
});

test("stage identities and no-money status are explicit and consistent",
  { skip: !required && !existsSync(path) }, () => {
  assert.ok(existsSync(path), "No connected synthetic run was performed; do not report acceptance");
  const r = JSON.parse(readFileSync(path, "utf8"));
  assert.deepEqual(r.stages.map(s => s.name), stages);
  assert.equal(r.bankOrPaymentSubmission, "PROHIBITED");
  assert.equal(r.officialAgencySubmission, "NOT_RUN");
  assert.equal(r.independentHumanUat, "NOT_RUN");
  assert.equal(r.realEmployerReconciliation, "NOT_RUN");
  assert.equal(r.clock?.mode, "CI_GUARDED_VIRTUAL_MANILA_MONTH_END");
  assert.equal(r.clock?.manilaWorkDate, "2026-09-30");
  assert.equal(r.clock?.realWallClockAttendance, false);
  assert.equal(r.clock?.actualApiCapture, true);
  assert.match(String(r.virtualGeneratedAt), /^2026-09-30T/);
  assert.ok(String(r.githubRunId).length > 0);
  assert.ok(r.stages.every(s => ["PASS","FAIL","BLOCKED","NOT_RUN"].includes(s.status)));
  if (r.result === "PASS") {
    assert.ok(isAccepted(r));
    assert.ok(Number.isInteger(r.lineage.employeeId));
    assert.ok(Number.isInteger(r.lineage.sourcePunchId));
    assert.ok(Number.isInteger(r.lineage.payrollRunId));
    assert.equal(r.lineage.periodStart, r.lineage.periodEnd);
    assert.equal(r.lineage.employeeHireDate, r.lineage.periodStart);
    assert.deepEqual(Object.keys(r.lineage.draftHashes).sort(),
      ["BIR","Pag-IBIG","PhilHealth","SSS"].sort());
    assert.ok(Object.values(r.lineage.draftHashes).every(
      h => typeof h === "string" && /^[a-f0-9]{64}$/.test(h)));
  }
  if (required) {
    assert.equal(r.sourceSha, process.env.PR_HEAD_SHA,
      "Connected report must come from the exact checked-out PR commit");
    assert.equal(r.githubRunId, process.env.GITHUB_RUN_ID,
      "Connected report must come from this workflow run");
    assert.equal(r.result, "PASS", "The dedicated connected workflow must pass all nine stages");
    assert.ok(isAccepted(r), "A failing or incomplete stage cannot be accepted");
  }
});


test("synthetic viewport acceptance reuses real role sessions without bypassing sign-in throttling",()=>{
  const source=readFileSync("scripts/qa/nine-stage-mobile-browser.mjs","utf8");
  assert.match(source,/let ownerSessionState = null/);
  assert.match(source,/let employeeSessionState = null/);
  assert.match(source,/ownerSessionState = await context\.storageState\(\)/);
  assert.match(source,/employeeSessionState = await restricted\.storageState\(\)/);
  assert.match(source,/!ownerSessionState/);
  assert.match(source,/!employeeSessionState/);
  assert.match(source,/Reused owner session must remain authenticated/);
  assert.match(source,/Employee login must return the actual fictional worker account/);
  assert.match(source,/An authenticated employee must receive 403/);
  assert.doesNotMatch(source,/TRUSTED_PROXY_HOPS|rate_limit_hits|DISABLE.*RATE_LIMIT|bypass.*rate.*limit/i);
});
