import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { createRows } from "../scripts/qa/tenant-table-rows/write/compliance-evidence.mjs";
import { selectTenantRowsByFamily } from "../scripts/qa/tenant-table-loader.mjs";
import { tenantFamilyCatalog } from "../scripts/qa/tenant-table-catalog.mjs";

const rows = createRows({ assert });
const c = { orgId: 11, org: { name: "Fictional-own employer" }, entityId: 31, workerId: 21, rank: 1, marker: "Fictional-own",
  owner: { id: 51, name: "Fictional owner" }, seeded: { id: 41, employeeNo: "Fictional-own-CE-DRILL" }, victim: { org: { id: 99 } }, victimSeeded: { id: 101 } };
const sha = text => createHash("sha256").update(text).digest("hex");
function evidence(key) {
  const before = { filings: [], drills: [], remediations: [{ id: 71 }], workers: [{ id: 21, organizationId: 11, employeeNo: c.marker },
    { id: 41, organizationId: 11, employeeNo: c.seeded.employeeNo }], runs: [{ id: 41 }], entries: [{ entry: { id: 61 } }],
    audits: [{ id: 1, organizationId: 11, metadata: { retained: true } }] };
  const after = structuredClone(before);
  let json, action, resource, metadata;
  if (key === "POST compliance/validate") {
    const validations = ["BIR", "BIR", "SSS", "PhilHealth", "Pag-IBIG"].map(agency => ({ agency, status: "LOCAL_WARNING", portalValidated: false, checks: [{ message: c.marker }] }));
    json = { ok: true, organizationName: c.org.name, portalValidated: false, overallStatus: "LOCAL_PREFLIGHT_COMPLETE_NOT_PORTAL_VALIDATED", checkedAt: "2026-10-26T00:00:00Z",
      engineRuleVersion: "PH-fictional", validations, dataCompleteness: { employees: 2, missingEmployeeTin: 2, missingEmployeeTinBranch: 2,
        missingMiddleName: 2, missingSss: 2, missingPhilHealth: 2, missingPagIbig: 2 } };
    action = "Government filing local preflight executed"; resource = c.org.name;
    metadata = { formsChecked: 5, localPasses: 0, localWarnings: 5, localFailures: 0, portalValidated: false, ruleVersion: json.engineRuleVersion };
  } else if (key === "POST compliance/filing-validations") {
    const body = ["# DRAFT ONLY, not a certified government submission file", "# kind=bir-1601c", "# payrollRun=41", "# period=Fictional-own compliance fixture",
      "# Validate against the live government portal before filing.", "# BIR Form 1601-C is monthly. This worksheet aggregates all released payroll runs in 2026-09, plus this run when it is the current final cutoff.",
      "Form,ApplicableMonth,WithholdingTax,Employees,PayrollRunsIncluded,Status", '"1601-C","2026-09","101.00","1","1","DRAFT"'].join("\n");
    const record = { id: 81, organizationId: 11, payrollRunId: 41, legalEntityId: 31, agency: "BIR", form: "1601-C", periodLabel: "Fictional-own compliance fixture",
      applicableMonth: "2026-09", employeeCount: 1, reportedTotal: "101.00", status: "generated", generatedBy: c.owner.name, generatorVersion: "bir-1601c-monthly-v1",
      fileName: "bir-1601c-monthly-draft-2026-09-run-41.csv", fileSha256: sha(body), agencyReference: null, submissionMethod: null, submittedAt: null, recordedBy: null, recordedAt: null };
    after.filings.push(record); json = { record: structuredClone(record), created: true }; action = "BIR 1601-C filing record created"; resource = record.periodLabel;
    metadata = { runId: 41, legalEntityId: 31, recordId: 81, fileSha256: record.fileSha256, generatorVersion: record.generatorVersion, applicableMonth: "2026-09", employeeCount: 1, reportedTotal: 101, submittedToAgency: false };
  } else {
    const canonical = { status: "blocked", summary: { high: 1, medium: 0, info: 0, unownedActionable: 1, readyToClose: 0, recordedExposure: 0, screeningExposure: 100 },
      blockers: [{ employeeNo: c.seeded.employeeNo }], actionPlan: [{ findingKey: "fictional" }], evidencePackSha256: "a".repeat(64), evidencePackVersion: "labor-inspection-pack-v2", rangeLabel: "Fictional range", sectionRowCounts: { workerRoster: 2 } };
    const drill = { ...canonical, snapshotSha256: sha(JSON.stringify(canonical)), id: 81, generatedBy: c.owner.name };
    const record = { id: 81, organizationId: 11, generatedBy: c.owner.name, status: drill.status, rangeLabel: drill.rangeLabel,
      evidencePackVersion: drill.evidencePackVersion, evidencePackSha256: drill.evidencePackSha256, snapshotSha256: drill.snapshotSha256,
      sectionRowCounts: drill.sectionRowCounts, blockerSummary: drill.blockers, actionPlan: drill.actionPlan, highFindings: 1, mediumFindings: 0,
      infoFindings: 0, unownedActionable: 1, readyToClose: 0, recordedExposure: "0.00", screeningExposure: "100.00" };
    after.drills.push(record); json = { drill: structuredClone(drill) }; action = "Labor inspection drill completed"; resource = drill.rangeLabel;
    metadata = { drillId: 81, status: drill.status, snapshotSha256: drill.snapshotSha256, evidencePackSha256: drill.evidencePackSha256,
      evidencePackVersion: drill.evidencePackVersion, summary: drill.summary, certificationClaimed: false };
  }
  after.audits.push({ id: 91, organizationId: 11, actor: c.owner.name, action, resource, metadata });
  return { before, after: structuredClone(after), response: { json } };
}

for (const row of rows) {
  test(row.key + " binds own persisted evidence and rejects no-op, foreign and swapped responses", () => {
    const e = evidence(row.key); row.expect(e.before, e.after, c, e.response);
    assert.throws(() => row.expect(e.before, e.before, c, e.response));
    assert.throws(() => row.expect(e.before, e.after, { ...c, orgId: 99 }, e.response));
    assert.throws(() => row.expect(e.before, e.after, { ...c, owner: { ...c.owner, name: "foreign" } }, e.response));
    assert.throws(() => row.expect(e.before, e.after, c, { json: {} }));
  });
  test(row.key + " retains source payroll/worker/remediation rows and all previous audit business fields", () => {
    for (const field of ["runs", "entries", "workers", "remediations"]) {
      const e = evidence(row.key); e.after[field][0].tampered = true; assert.throws(() => row.expect(e.before, e.after, c, e.response));
    }
    for (const field of ["actor", "organizationId", "action", "resource", "metadata"]) {
      const e = evidence(row.key); e.after.audits.at(-1)[field] = "tampered"; assert.throws(() => row.expect(e.before, e.after, c, e.response));
    }
    const e = evidence(row.key); e.after.audits[0].metadata.retained = false; assert.throws(() => row.expect(e.before, e.after, c, e.response));
  });
  test(row.key + " uses genuine victim employer/run IDs", () => {
    assert.equal(row.ownBody(c).organizationId, 11); assert.equal(row.foreignBody(c).organizationId, 99);
    if (row.forged) { assert.equal(row.forged.body(c).organizationId, 11); assert.equal(row.forged.body(c).runId, 101); assert.equal(row.forged.status, 404); }
  });
}

test("filing/drill hashes and non-certification cannot be replaced by success-looking evidence", () => {
  for (const [key, change] of [
    [rows[0].key, e => { e.response.json.portalValidated = true; }],
    [rows[1].key, e => { e.after.filings[0].fileSha256 = "b".repeat(64); e.response.json.record.fileSha256 = "b".repeat(64); }],
    [rows[1].key, e => { e.after.filings[0].status = "accepted"; e.response.json.record.status = "accepted"; }],
    [rows[2].key, e => { e.after.drills[0].snapshotSha256 = "b".repeat(64); e.response.json.drill.snapshotSha256 = "b".repeat(64); }],
    [rows[2].key, e => { e.response.json.drill.blockers[0].employeeNo = "foreign"; }],
  ]) { const e = evidence(key); change(e); assert.throws(() => rows.find(row => row.key === key).expect(e.before, e.after, c, e.response)); }
});

test("family selection defaults to the complete suite and fails closed on invalid/unknown/partial selections", () => {
  const catalog = tenantFamilyCatalog("write"), all = catalog.map(row => ({ key: row.key }));
  assert.equal(selectTenantRowsByFamily("write", all, undefined), all);
  assert.deepEqual(selectTenantRowsByFamily("write", all, "compliance-evidence").map(row => row.key), rows.map(row => row.key));
  for (const bad of ["", "../compliance", "missing", "COMPLIANCE"]) assert.throws(() => selectTenantRowsByFamily("write", all, bad));
  assert.throws(() => selectTenantRowsByFamily("write", all.filter(row => row.key !== rows[0].key), "compliance-evidence"));
  assert.throws(() => selectTenantRowsByFamily("write", [...all, { key: rows[0].key }], "compliance-evidence"));
});

test("unknown credit families never write or select unrelated pending rows", () => {
  const file = "scripts/qa/tenant-isolation-coverage-manifest.json", before = readFileSync(file, "utf8");
  assert.throws(() => execFileSync(process.execPath, ["scripts/qa/tenant-table-credit.mjs", "--family", "missing", "--check"], { stdio: "pipe" }));
  const report = JSON.parse(execFileSync(process.execPath, ["scripts/qa/tenant-table-credit.mjs", "--family", "compliance-evidence", "--check"], { encoding: "utf8" }));
  const manifest = JSON.parse(before), expected = rows.filter(row => {
    const [verb, route] = row.key.split(" "); return manifest.allApiRouteFiles["src/app/api/" + route + "/route.ts"].methods.find(method => method.name === verb).status === "GAP";
  }).length;
  assert.equal(report.newlyCredited, expected); assert.equal(readFileSync(file, "utf8"), before);
});
