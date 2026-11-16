import assert from "node:assert/strict";
import test from "node:test";
import { createHash, createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { checkPilotPack, preparePilotPack, scopeBlockers, unassignedScope } from "../scripts/qa/first-employer-pilot-pack";
import { JOURNAL_COLUMNS, PAYROLL_COLUMNS } from "../src/lib/private-parallel-payroll-reconciliation";

function fixture(t: test.TestContext) {
  const parent = mkdtempSync(join(tmpdir(), "fictional-pilot-pack-test-"));
  t.after(() => {
    assert.ok(realpathSync(parent).startsWith(realpathSync(tmpdir()) + sep));
    assert.ok(parent.includes("fictional-pilot-pack-test-"));
    rmSync(parent, { recursive: true });
  });
  const prepared = preparePilotPack(parent);
  return { parent, root: prepared.directory, prepared };
}
function populate(root: string) {
  const scope = { ...unassignedScope(), legalEntityCode: "PRIVATE-ENTITY-OPAQUE",
    region: "NCR", industry: "Services", employeeCount: 1, payFrequency: "semi-monthly" };
  writeFileSync(join(root, "scope.json"), JSON.stringify(scope));
  const key = createHmac("sha256", "FICTIONAL-TEST-NOT-A-REAL-KEY").update("fictional-worker").digest("hex");
  const cycles = ["2026-06","2026-07"].map((period, index) => {
    const e = scope.legalEntityCode;
    // Hand-fixed arithmetic fixture only; does not assert statutory rates.
    const payroll = [PAYROLL_COLUMNS.join(","), [key,e,period,
      "20000.00","18500.00","875.00","500.00","100.00","1520.00","0.00","0.00","5.00",
      "17000.00","1750.00","15.00","500.00","100.00"].join(","),""].join("\n");
    const journal = [JOURNAL_COLUMNS.join(","), ...[
      ["PAYROLL_GROSS","20000.00","0.00"],["BANK_NET","0.00","17000.00"],
      ["SSS_PAYABLE","0.00","2640.00"],["PHILHEALTH_PAYABLE","0.00","1000.00"],
      ["PAGIBIG_PAYABLE","0.00","200.00"],["BIR_WHT_PAYABLE","0.00","1520.00"],
      ["OTHER_DEDUCTIONS_PAYABLE","0.00","5.00"],["EMPLOYER_STATUTORY_EXPENSE","2365.00","0.00"],
    ].map(([account,debit,credit]) => [account,e,period,debit,credit].join(",")),""].join("\n");
    const source = (name: string, bytes: string) => {
      const filePath = index + "-" + name + ".csv";
      writeFileSync(join(root,"evidence",filePath), bytes);
      return { filePath, sha256: createHash("sha256").update(bytes).digest("hex") };
    };
    return { period, incumbentPayroll: source("incumbent-pay",payroll),
      linawPayroll: source("linaw-pay",payroll), incumbentJournal: source("incumbent-gl",journal),
      linawJournal: source("linaw-gl",journal) };
  });
  const manifest = { schemaVersion: 1, legalEntityCode: scope.legalEntityCode, cycles };
  writeFileSync(join(root,"parallel-manifest.json"), JSON.stringify(manifest));
  return { scope, manifest, key };
}

test("unassigned preparation is private, unique, header-only and cannot pass", t => {
  const { root, parent, prepared } = fixture(t);
  const second = preparePilotPack(parent);
  assert.notEqual(root, second.directory);
  assert.equal(prepared.status,"PREPARED_UNASSIGNED");
  assert.equal(prepared.reconciliation,"NOT_RUN");
  assert.equal(readFileSync(join(root,"templates/payroll.csv"),"utf8"), PAYROLL_COLUMNS.join(",")+"\n");
  assert.equal(readFileSync(join(root,"templates/journal.csv"),"utf8"), JOURNAL_COLUMNS.join(",")+"\n");
  const report = checkPilotPack(root);
  assert.equal(report.status,"BLOCKED");assert.equal(report.reconciliation,"NOT_RUN");
  assert.ok(report.blockers.includes("EMPLOYER_UNASSIGNED"));
  if (process.platform !== "win32") {
    assert.equal(statSync(root).mode & 0o777,0o700);
    assert.equal(statSync(join(root,"scope.json")).mode & 0o777,0o600);
  }
});

test("scope rejects unknown fields, money activation and unsupported cohorts", () => {
  const base = { ...unassignedScope(), legalEntityCode: "OPAQUE-123", region: "NCR",
    industry: "Services", employeeCount: 5, payFrequency: "monthly" };
  assert.deepEqual(scopeBlockers(base),[]);
  for (const mutation of [
    {mode:"live"}, {siteCount:2}, {workerBasis:"daily"}, {employeeCount:26},
    {requiredMonths:1}, {exceptions:["final-pay"]}, {payFrequency:"weekly"},
    {region:"UNKNOWN"}, {providerKey:"DO-NOT-ACCEPT"},
  ]) assert.ok(scopeBlockers({...base,...mutation}).length);
});

test("real offline two-month payroll and GL comparison never grants launch/payment approval", t => {
  const {root} = fixture(t);const {key} = populate(root);
  const report = checkPilotPack(root);
  assert.equal(report.status,"ARITHMETIC_RECONCILED_REVIEW_PENDING");
  assert.equal(report.reconciliation,"PASSED");
  assert.equal(report.verifiedFileHashCount,8);
  assert.deepEqual(report.matchedEmployeesPerMonth,[1,1]);
  for (const flag of ["productionReady","approvedForPayment","operationalApproval","independentReviewVerified","runtimeFlagsInspected"] as const)
    assert.equal(report[flag],false);
  const output = JSON.stringify(report);
  for (const privateValue of [key,"PRIVATE-ENTITY-OPAQUE","20000.00",root]) assert.ok(!output.includes(privateValue));
});

test("missing month, wrong scope and tampered CSV cannot inherit a successful result", t => {
  const {root} = fixture(t);const {manifest,scope} = populate(root);
  manifest.cycles.pop();writeFileSync(join(root,"parallel-manifest.json"),JSON.stringify(manifest));
  assert.equal(checkPilotPack(root).status,"BLOCKED");
  populate(root);
  writeFileSync(join(root,"scope.json"),JSON.stringify({...scope,employeeCount:2}));
  assert.ok(checkPilotPack(root).blockers.includes("SCOPE_ROSTER_COUNT_MISMATCH"));
  writeFileSync(join(root,"scope.json"),JSON.stringify({...scope,legalEntityCode:"OTHER-ENTITY"}));
  assert.ok(checkPilotPack(root).blockers.includes("SCOPE_MANIFEST_EMPLOYER_MISMATCH"));
  populate(root);
  writeFileSync(join(root,"evidence/0-linaw-pay.csv"),"TAMPERED");
  assert.equal(checkPilotPack(root).status,"BLOCKED");
});

test("an actual two-cent mismatch and reused source file fail canonical checks", t => {
  const {root} = fixture(t);let {manifest} = populate(root);
  const source = manifest.cycles[0].linawPayroll;
  const path = join(root,"evidence",source.filePath);
  const changed = readFileSync(path,"utf8").replace("1520.00","1520.02").replace("17000.00","16999.98");
  writeFileSync(path,changed);source.sha256=createHash("sha256").update(changed).digest("hex");
  writeFileSync(join(root,"parallel-manifest.json"),JSON.stringify(manifest));
  assert.equal(checkPilotPack(root).status,"BLOCKED");
  ({manifest}=populate(root));
  manifest.cycles[0].linawPayroll=manifest.cycles[0].incumbentPayroll;
  writeFileSync(join(root,"parallel-manifest.json"),JSON.stringify(manifest));
  assert.equal(checkPilotPack(root).status,"BLOCKED");
  ({manifest}=populate(root));
  manifest.cycles[0].linawPayroll.filePath="PRIVATE-NAME-secret.csv";
  writeFileSync(join(root,"parallel-manifest.json"),JSON.stringify(manifest));
  const redacted=checkPilotPack(root);
  assert.ok(redacted.blockers.includes("CANONICAL_RECONCILIATION_FAILED"));
  assert.ok(!JSON.stringify(redacted).includes("PRIVATE-NAME"));
});

test("actual CLI fails unassigned inputs and redacts malformed private input errors", t => {
  const {root} = fixture(t);
  const script=resolve("scripts/qa/first-employer-pilot-pack.ts");
  const run=()=>spawnSync(process.execPath,["--import","tsx",script,"check",root],{encoding:"utf8",timeout:30000});
  const first=run();assert.equal(first.status,1,first.stderr);
  assert.equal(JSON.parse(first.stdout).reconciliation,"NOT_RUN");
  writeFileSync(join(root,"scope.json"),'{"PRIVATE-EMPLOYEE-NAME":');
  const bad=run();assert.equal(bad.status,2);
  assert.ok(!bad.stderr.includes(root));assert.ok(!bad.stderr.includes("PRIVATE-EMPLOYEE-NAME"));
  assert.equal(bad.stdout,"");
  writeFileSync(join(root,"scope.json")," ".repeat(256*1024+1));
  assert.equal(run().status,2,"Oversize private JSON is refused");
});
