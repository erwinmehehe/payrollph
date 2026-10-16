import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const path = "qa-artifacts/nine-stage-connected-report.json";
const required = process.env.NINE_STAGE_EVIDENCE_REQUIRED === "true";
const stages = ["Hire","Onboard","Schedule","Clock In","Approve Time","Run Payroll",
  "Review","Release Payroll Records","Prepare Filing Evidence"];

function isAccepted(r) {
  return Boolean(r && r.result === "PASS" && Array.isArray(r.stages)
    && (!r.annualJourneyRequired || (r.annualJourney?.result === "PASS"
      && r.annualJourney.employeeId === r.lineage?.employeeId
      && r.annualJourney.payrollRunId === r.lineage?.payrollRunId
      && r.annualJourney.organizationId === r.lineage?.organizationId
      && /^[a-f0-9]{64}$/.test(r.annualJourney.pdfSha256 ?? "")
      && r.annualJourney.paidThirteenthCentavos > 0
      && r.annualJourney.refundedTaxCentavos > 0
      && r.annualJourney.unsigned === true && r.annualJourney.submitted === false))
    && r.stages.length === stages.length
    && r.stages.every((s, index) => s?.name === stages[index] && s.status === "PASS")
    && Array.isArray(r.employerBStages)
    && r.employerBStages.length === stages.length
    && r.employerBStages.every((s, index) => s?.name === stages[index] && s.status === "PASS")
    && Number.isInteger(r.lineage?.employerB?.employeeId)
    && r.lineage.employerB.employeeId !== r.lineage.employeeId
    && r.lineage.employerB.organizationId === r.lineage.shadowOrganizationId
    && r.lineage.employerB.payrollRunId !== r.lineage.payrollRunId
    && r.lineage.employerB.sourcePunchId !== r.lineage.sourcePunchId
    && (r.lineage?.hireMode !== "governed" || (
      r.lineage.governedHire?.employeeId === r.lineage.employeeId
      && ["employeeId", "applicantId", "businessProcessId", "positionId", "requisitionId"]
        .every(key => Number.isInteger(r.lineage.governedHire?.[key]) && r.lineage.governedHire[key] > 0)
    )));
}

test("missing or incomplete connected evidence is never acceptance", () => {
  const passes = stages.map(name => ({ name, status: "PASS" }));
  assert.equal(isAccepted(null), false);
  assert.equal(isAccepted({ result: "PASS", stages: [] }), false);
  assert.equal(isAccepted({ result: "FAIL", stages: passes }), false);
  assert.equal(isAccepted({ result: "PASS", stages: passes.map((s, i) =>
    i === 5 ? { ...s, status: "FAIL" } : s) }), false);
});

test("governed journey receipt rejects sidecar worker substitution and incomplete source lineage", () => {
  const r = { result: "PASS", stages: stages.map(name => ({ name, status: "PASS" })),
    employerBStages: stages.map(name => ({ name, status: "PASS" })),
    lineage: { hireMode: "governed", employeeId: 10, payrollRunId: 11, sourcePunchId: 12,
      shadowOrganizationId: 13, employerB: {
        employeeId: 20, organizationId: 13, payrollRunId: 21, sourcePunchId: 22,
      },
      governedHire: { employeeId: 10, applicantId: 1, businessProcessId: 2, positionId: 3, requisitionId: 4 } } };
  assert.equal(isAccepted(r), true);
  const annual = { ...structuredClone(r), annualJourneyRequired: true };
  assert.equal(isAccepted(annual), false, "Nine stages alone cannot prove annual certificate completion");
  annual.lineage.organizationId = 30;
  annual.annualJourney = { result: "PASS", organizationId: 30, employeeId: 10, payrollRunId: 11,
    pdfSha256: "a".repeat(64), paidThirteenthCentavos: 100, refundedTaxCentavos: 1, unsigned: true, submitted: false };
  assert.equal(isAccepted(annual), true);
  annual.annualJourney.employeeId = 20;
  assert.equal(isAccepted(annual), false, "A seeded or different worker's certificate is not connected evidence");
  const wrong = structuredClone(r); wrong.lineage.governedHire.employeeId = 11;
  assert.equal(isAccepted(wrong), false);
  const missing = structuredClone(r); delete missing.lineage.governedHire.applicantId;
  assert.equal(isAccepted(missing), false);
  const shadow = structuredClone(r); shadow.employerBStages[6].status = "NOT_RUN";
  assert.equal(isAccepted(shadow), false);
  const samePayroll = structuredClone(r);
  samePayroll.lineage.employerB.payrollRunId = r.lineage.payrollRunId;
  assert.equal(isAccepted(samePayroll), false);
});

test("stage identities and no-money status are explicit and consistent",
  { skip: !required && !existsSync(path) }, () => {
  assert.ok(existsSync(path), "No connected synthetic run was performed; do not report acceptance");
  const r = JSON.parse(readFileSync(path, "utf8"));
  assert.deepEqual(r.stages.map(s => s.name), stages);
  assert.deepEqual(r.employerBStages.map(s => s.name), stages);
  assert.equal(r.bankOrPaymentSubmission, "PROHIBITED");
  assert.equal(r.officialAgencySubmission, "NOT_RUN");
  assert.equal(r.independentHumanUat, "NOT_RUN");
  assert.equal(r.realEmployerReconciliation, "NOT_RUN");
  assert.equal(r.clock?.mode, "CI_GUARDED_VIRTUAL_MANILA_MONTH_END");
  assert.match(String(r.clock?.manilaWorkDate), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(r.clock?.realWallClockAttendance, false);
  assert.equal(r.clock?.actualApiCapture, true);
  assert.ok(String(r.virtualGeneratedAt).startsWith(r.clock.manilaWorkDate + "T"));
  assert.ok(String(r.githubRunId).length > 0);
  assert.ok(r.stages.every(s => ["PASS","FAIL","BLOCKED","NOT_RUN"].includes(s.status)));
  assert.ok(r.employerBStages.every(s => ["PASS","FAIL","BLOCKED","NOT_RUN"].includes(s.status)));
  if (r.result === "PASS") {
    assert.ok(isAccepted(r));
    assert.ok(Number.isInteger(r.lineage.employeeId));
    assert.ok(Number.isInteger(r.lineage.sourcePunchId));
    assert.ok(Number.isInteger(r.lineage.payrollRunId));
    assert.equal(r.lineage.periodStart, r.lineage.periodEnd);
    assert.equal(r.lineage.employeeHireDate, r.lineage.periodStart);
    assert.notEqual(r.lineage.employeeId, r.lineage.employerB.employeeId);
    assert.notEqual(r.lineage.payrollRunId, r.lineage.employerB.payrollRunId);
    assert.notEqual(r.lineage.sourcePunchId, r.lineage.employerB.sourcePunchId);
    assert.equal(r.lineage.employerB.organizationId, r.lineage.shadowOrganizationId);
    assert.equal(r.lineage.employerB.periodStart, r.lineage.periodStart);
    assert.equal(r.lineage.employerB.periodEnd, r.lineage.periodEnd);
    assert.deepEqual(Object.keys(r.lineage.employerB.draftHashes).sort(),
      ["BIR","Pag-IBIG","PhilHealth","SSS"].sort());
    assert.ok(Object.values(r.lineage.employerB.draftHashes).every(
      h => typeof h === "string" && /^[a-f0-9]{64}$/.test(h)));
    if (r.lineage.hireMode === "governed") {
      assert.equal(r.lineage.governedHire.employeeId, r.lineage.employeeId,
        "Candidate conversion must be the SAME worker whose time and payroll were released");
      for (const key of ["applicantId", "businessProcessId", "positionId", "requisitionId"])
        assert.ok(Number.isInteger(r.lineage.governedHire[key]) && r.lineage.governedHire[key] > 0);
      assert.equal(r.lineage.governedHire.positionSource, "approved-fixture-not-a-published-workforce-plan");
    }
    assert.deepEqual(Object.keys(r.lineage.draftHashes).sort(),
      ["BIR","Pag-IBIG","PhilHealth","SSS"].sort());
    assert.ok(Object.values(r.lineage.draftHashes).every(
      h => typeof h === "string" && /^[a-f0-9]{64}$/.test(h)));
  }
  if (required) {
    assert.equal(r.clock.manilaWorkDate, process.env.NINE_STAGE_SYNTHETIC_CLOCK,
      "Connected report must use this CI run's guarded month-end");
    assert.equal(r.sourceSha, process.env.PR_HEAD_SHA,
      "Connected report must come from the exact checked-out PR commit");
    assert.equal(r.githubRunId, process.env.GITHUB_RUN_ID,
      "Connected report must come from this workflow run");
    assert.ok(["16","18"].includes(process.env.NINE_STAGE_PG_MAJOR),
      "Connected report requires explicit known PG major");
    assert.equal(r.postgresMajor, Number(process.env.NINE_STAGE_PG_MAJOR),
      "Connected receipt must match actual disposable PostgreSQL major");
    assert.equal(r.scope,
      "synthetic-local-postgres" + process.env.NINE_STAGE_PG_MAJOR + "-only",
      "Do not claim PG18 journey proof using an earlier PG16 fixture");
    assert.equal(r.lineage.hireMode, process.env.NINE_STAGE_HIRE_MODE ?? "direct");
    assert.equal(r.result, "PASS", "The dedicated connected workflow must pass both sets of nine stages");
    assert.ok(isAccepted(r), "A failing or incomplete stage cannot be accepted");
  }
});


test("synthetic viewport acceptance reuses real role sessions without bypassing sign-in throttling",()=>{
  const source=readFileSync("scripts/qa/nine-stage-mobile-browser.mjs","utf8");
  assert.match(source,/let ownerState;/);
  assert.match(source,/let employeeState;/);
  assert.match(source,/ownerState = await context\.storageState\(\)/);
  assert.match(source,/employeeState = await restricted\.storageState\(\)/);
  assert.match(source,/!ownerState/);
  assert.match(source,/!employeeState/);
  assert.match(source,/await page\.locator\("\.company-switcher"\)\.waitFor/);
  assert.match(source,/Employee login must return the actual fictional worker account/);
  assert.match(source,/An authenticated employee must receive 403/);
  assert.doesNotMatch(source,/TRUSTED_PROXY_HOPS|rate_limit_hits|DISABLE.*RATE_LIMIT|bypass.*rate.*limit/i);
});
