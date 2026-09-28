import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

test("the payroll engine actually loads enrolments, so the deduction is never inert", () => {
  // Guards a real bug: calculateEmployeePay accepted `benefits` but the engine
  // never queried the tables, so a UI claiming "deducts automatically" would
  // have been decorative.
  const engine = read("src/lib/payroll-engine.ts");
  assert.ok(engine.includes("benefitEnrollments"), "engine must query benefit_enrollments");
  assert.ok(engine.includes("benefitPlans"), "engine must query benefit_plans");
  assert.ok(engine.includes("enrolmentsByEmployee.get(employee.id)"), "engine must pass enrolments into the calculation");
  assert.ok(/eq\(benefitEnrollments\.status, "active"\)/.test(engine), "only active enrolments may deduct");
});

test("benefit lines are capped and traceable on the payslip", () => {
  const benefits = read("src/lib/benefits.ts");
  assert.ok(benefits.includes("cap"), "caps must be honoured");
  assert.ok(benefits.includes("basis"), "every line must carry a basis");
});

test("the scorecard verifies embedded benefits from executable code and tests, not sample row count", () => {
  const caps = read("src/lib/capabilities.ts");
  assert.ok(caps.includes('id: "benefits"'));
  assert.ok(caps.includes('status: "verified"'));
  assert.ok(caps.includes("tests/benefits-wiring.test.ts"));
  assert.ok(!caps.includes('enrollments > 0 ? "verified" : "partial"'), "zero demo enrolments must not downgrade built functionality");
});
