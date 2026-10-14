import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { benefitEnrollmentReviewConfirmed, benefitEnrollmentReviewKey } from "../src/lib/benefit-enrollment-review";

const base = {
  organizationId: 11, employeeId: 27, planId: 9,
  monthlyContribution: "1000.00", startedOn: "2026-10-13",
};

test("benefit enrollment review binds employer, employee, plan, cents and date", () => {
  const reviewed = benefitEnrollmentReviewKey(base);
  assert.ok(reviewed);
  assert.equal(benefitEnrollmentReviewConfirmed(reviewed, reviewed), true);
  assert.equal(benefitEnrollmentReviewConfirmed(null, reviewed), false);
  for (const change of [
    { organizationId: 12 }, { employeeId: 28 }, { planId: 10 },
    { monthlyContribution: "1000.01" }, { startedOn: "2026-10-14" },
  ]) {
    assert.equal(benefitEnrollmentReviewConfirmed(reviewed, benefitEnrollmentReviewKey({ ...base, ...change })), false,
      "changing any reviewed field must invalidate confirmation");
  }
});

test("review rejects incomplete, impossible, and unrepresentable enrollment details", () => {
  for (const change of [
    { organizationId: 0 }, { employeeId: 0 }, { planId: 0 },
    { startedOn: "" }, { startedOn: "2026-02-30" }, { startedOn: "2026-13-01" },
    { monthlyContribution: "" }, { monthlyContribution: "-1.00" },
    { monthlyContribution: "100.001" }, { monthlyContribution: "1e3" },
    { monthlyContribution: "100000000.00" }, { monthlyContribution: Number.NaN },
  ]) {
    assert.equal(benefitEnrollmentReviewKey({ ...base, ...change }), null);
  }
  assert.ok(benefitEnrollmentReviewKey({ ...base, startedOn: "2028-02-29", monthlyContribution: "0.00" }));
  assert.equal(
    benefitEnrollmentReviewKey({ ...base, monthlyContribution: "1000" }),
    benefitEnrollmentReviewKey(base),
    "same monthly centavo amount is the same reviewed enrollment",
  );
});

test("both optional enrollment screens recheck exact review key and clear on input changes", () => {
  for (const path of ["src/components/benefits-panel.tsx", "src/components/hmo-benefits-panel.tsx"]) {
    const component = readFileSync(path, "utf8");
    assert.match(component, /benefitEnrollmentReviewKey\(/);
    assert.match(component, /benefitEnrollmentReviewConfirmed\(/);
    assert.match(component, /setReviewedKey\(null\)/);
    assert.match(component, /disabled=\{enhancedEnrollment && !reviewConfirmed\}/);
    assert.match(component, /enforce|review|confirm/i);
  }
});

test("existing benefits write API retains independent role, employer, unit and origin checks", () => {
  const route = readFileSync("src/app/api/benefits/route.ts", "utf8");
  const post = route.slice(route.indexOf("export async function POST("), route.indexOf("export async function DELETE("));
  assert.match(post, /enforceSameOriginMutation\(request\)/);
  assert.match(post, /getSessionUser\(\)/);
  assert.match(post, /assertOrganizationRole\([\s\S]*?PEOPLE_PAYROLL_ROLES/);
  assert.match(post, /getAccess\(user\.id, organizationId\)/);
  assert.match(post, /eq\(employees\.organizationId, organizationId\)/);
  assert.match(post, /eq\(benefitPlans\.organizationId, organizationId\)/);
  assert.match(post, /assertScope\(access, employee\.orgUnitId\)/);
  assert.match(post, /recordAuditEvent\(/);
  assert.match(post, /runAutomationEventSafely\(/);
  const hmo = readFileSync("src/components/hmo-benefits-panel.tsx", "utf8");
  assert.match(hmo, /fetch\("\/api\/benefits", \{/);
});
