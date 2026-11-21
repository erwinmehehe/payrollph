import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildClientOnboardingChecklist } from "../src/lib/client-onboarding-checklist";

const base = {
  organizationName: "Acme",
  legalName: "Acme Inc.",
  employeeRecords: 0,
  activeTeamMembers: 1,
  employerRegistrationFields: 0,
  hasMultipleLegalEmployers: false,
};

test("new tenant has honest field-presence progress, not payroll acceptance", () => {
  const report = buildClientOnboardingChecklist(15, base);
  assert.equal(report.requiredTotal, 3);
  assert.equal(report.recordedRequired, 1);
  assert.equal(report.steps.find((step) => step.id === "employees")?.recorded, false);
  assert.equal(report.steps.find((step) => step.id === "team")?.optional, true);
  assert.ok(report.steps.every((step) => step.destination.startsWith("/app?organizationId=15")));
});

test("staff and recorded identifiers do not imply verified payroll readiness", () => {
  const report = buildClientOnboardingChecklist(15, {
    ...base, employeeRecords: 14, activeTeamMembers: 2, employerRegistrationFields: 4,
  });
  assert.equal(report.recordedRequired, 3);
  assert.equal(report.steps.filter((step) => step.recorded).length, 4);
  assert.match(report.steps.find((step) => step.id === "registrations")!.detail, /does not verify/);
});

test("multi-legal-employer registration status remains pending", () => {
  const report = buildClientOnboardingChecklist(15, {
    ...base, employerRegistrationFields: 4, hasMultipleLegalEmployers: true,
  });
  assert.equal(report.steps.find((step) => step.id === "registrations")?.recorded, false);
});

test("rejects ambiguous or unsafe employer identifiers", () => {
  for (const id of [0, -1, 1.2, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => buildClientOnboardingChecklist(id, base));
  }
});
