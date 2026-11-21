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

test("multi-entity registration evidence cannot be satisfied by organization-level identifiers", () => {
  const report = buildClientOnboardingChecklist(15, {
    ...base, employeeRecords: 2, employerRegistrationFields: 4,
    hasMultipleLegalEmployers: true, legalEmployerScopeEnabled: true,
    legalEmployerCount: 2, legalEmployerRegistrationsComplete: 1,
  });
  const registrations = report.steps.find((step) => step.id === "registrations");
  assert.equal(registrations?.recorded, false);
  assert.match(registrations!.detail, /1 of 2 active legal employers/);
  assert.equal(report.recordedRequired, 2);
});

test("only fully recorded active legal employers advance registration presence", () => {
  for (const count of [1, 2]) {
    const report = buildClientOnboardingChecklist(15, {
      ...base, employerRegistrationFields: 0,
      hasMultipleLegalEmployers: count > 1, legalEmployerScopeEnabled: true,
      legalEmployerCount: count, legalEmployerRegistrationsComplete: count,
    });
    assert.equal(report.steps.find((step) => step.id === "registrations")?.recorded, true);
    assert.match(report.steps.find((step) => step.id === "registrations")!.detail, /independent review/);
  }
});

test("feature-enabled onboarding refuses zero, missing or contradictory legal-employer evidence", () => {
  for (const [count, complete] of [[0, 0], [2, 0], [2, 1], [2, 3], [-1, -1]]) {
    const report = buildClientOnboardingChecklist(15, {
      ...base, employerRegistrationFields: 4,
      legalEmployerScopeEnabled: true, legalEmployerCount: count,
      legalEmployerRegistrationsComplete: complete,
      hasMultipleLegalEmployers: count > 1,
    });
    assert.equal(report.steps.find((step) => step.id === "registrations")?.recorded, false);
  }
});
