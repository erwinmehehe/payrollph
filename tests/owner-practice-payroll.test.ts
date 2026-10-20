import assert from "node:assert/strict";
import test from "node:test";
import { buildPracticePayroll, ownerPracticePayroll } from "../src/lib/practice-payroll-server";
import { practicePayrollAllowed, samplePayslipText, totalPracticePayroll } from "../src/lib/practice-payroll";

test("practice is exact-true default-off and never computes or adds JSON fields when unavailable to the owner", () => {
  let calls = 0;
  const build = () => { calls++; return buildPracticePayroll(); };
  for (const value of [undefined, "false", "TRUE", "1", ""]) {
    const env = value === undefined ? {} : { OWNER_PRACTICE_PAYROLL_ENABLED: value };
    assert.deepEqual(ownerPracticePayroll({ role: "owner", companyWide: true }, env, build), {});
  }
  for (const role of ["employee", "manager", "hr", "payroll", "admin", "checker"]) {
    assert.deepEqual(ownerPracticePayroll({ role, companyWide: true }, { OWNER_PRACTICE_PAYROLL_ENABLED: "true" }, build), {});
  }
  assert.equal(practicePayrollAllowed(true, { role: "owner", companyWide: false }), false);
  assert.deepEqual(ownerPracticePayroll(null, { OWNER_PRACTICE_PAYROLL_ENABLED: "true" }, build), {});
  assert.equal(calls, 0);
  const legacy = { selectedOrganization: { id: 42 }, firstPayrollReadiness: { completed: 2 } };
  assert.equal(JSON.stringify({ ...legacy, ...ownerPracticePayroll({ role: "owner", companyWide: true }, {}) }), JSON.stringify(legacy));
});

test("actual canonical engine computes reproducible fictional monthly, mid-hire and daily payroll without database I/O", () => {
  const payload = buildPracticePayroll();
  assert.equal(payload.status, "ready");
  if (payload.status !== "ready") throw Error("Expected canonical fixture");
  assert.deepEqual(buildPracticePayroll(), payload);
  assert.equal(payload.scenarios.length, 3);
  const [monthly, hire, daily] = payload.scenarios;
  assert.equal(monthly.workers[0].grossCents, 1500000);
  assert.equal(monthly.workers[1].grossCents, 1100000);
  assert.ok(hire.workers[0].grossCents > 0 && hire.workers[0].grossCents < monthly.workers[1].grossCents);
  assert.equal(daily.workers[0].grossCents, 500000);
  for (const scenario of payload.scenarios) {
    const result = totalPracticePayroll(scenario, scenario.workers.map(worker => worker.id));
    assert.equal(result.grossCents - result.deductionCents, result.netCents);
    for (const worker of result.workers) {
      assert.match(worker.name, /^Fictional /);
      assert.equal(worker.lines.reduce((sum, line) => sum + line.cents, 0), worker.netCents);
      const text = samplePayslipText(worker);
      assert.match(text, /^PRACTICE ONLY — NOT A REAL PAYSLIP/);
      assert.match(text, /No wages paid/);
      assert.match(text, new RegExp(`Sample net: PHP ${(worker.netCents / 100).toFixed(2).replace(".", "\\.")}`));
      assert.ok(!("bankAccount" in worker) && !("organizationId" in worker));
    }
  }
});

test("empty, duplicate, foreign/live IDs and unreconciled sample amounts fail explicitly", () => {
  const payload = buildPracticePayroll();
  if (payload.status !== "ready") throw Error("Expected fixture");
  const scenario = payload.scenarios[0];
  assert.throws(() => totalPracticePayroll(scenario, []), /Select at least/);
  assert.throws(() => totalPracticePayroll(scenario, ["practice-1", "practice-1"]), /duplicates/);
  assert.throws(() => totalPracticePayroll(scenario, ["EMP-0001"]), /Unknown fictional/);
  const damaged = structuredClone(scenario); damaged.workers[0].netCents++;
  assert.throws(() => totalPracticePayroll(damaged, ["practice-1"]), /does not reconcile/);
});

test("owner fixture failure exposes only generic practice-unavailable state", () => {
  assert.deepEqual(ownerPracticePayroll({ role: "owner", companyWide: true }, { OWNER_PRACTICE_PAYROLL_ENABLED: "true" }, () => { throw Error("private diagnostic"); }), { practicePayroll: { status: "unavailable" } });
});
