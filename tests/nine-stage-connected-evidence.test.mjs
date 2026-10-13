import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
const path = "qa-artifacts/nine-stage-connected-report.json";
const stages = ["Hire","Onboard","Schedule","Clock In","Approve Time","Run Payroll",
  "Review","Release Payroll Records","Prepare Filing Evidence"];
test("a missing connected report never passes", () => {
  assert.ok(existsSync(path), "No synthetic run was performed; do not report acceptance");
});
test("stage identities and no-money status are explicit and consistent", () => {
  const r = JSON.parse(readFileSync(path,"utf8"));
  assert.deepEqual(r.stages.map(s=>s.name),stages);
  assert.equal(r.bankOrPaymentSubmission,"PROHIBITED");
  assert.equal(r.officialAgencySubmission,"NOT_RUN");
  assert.equal(r.independentHumanUat,"NOT_RUN");
  assert.equal(r.realEmployerReconciliation,"NOT_RUN");
  assert.ok(r.stages.every(s=>["PASS","FAIL","BLOCKED","NOT_RUN"].includes(s.status)));
  if(r.result === "PASS") {
    assert.ok(r.stages.every(s=>s.status==="PASS"));
    assert.ok(Number.isInteger(r.lineage.employeeId));
    assert.ok(Number.isInteger(r.lineage.sourcePunchId));
    assert.ok(Number.isInteger(r.lineage.payrollRunId));
    assert.equal(r.lineage.periodStart,r.lineage.periodEnd);
    assert.deepEqual(Object.keys(r.lineage.draftHashes).sort(),
      ["BIR","Pag-IBIG","PhilHealth","SSS"].sort());
    assert.ok(Object.values(r.lineage.draftHashes).every(
      h=>typeof h==="string" && /^[a-f0-9]{64}$/.test(h)));
  }
});
