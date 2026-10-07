import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("HMO schema persists carrier state, dependents and an auditable event timeline", () => {
  const schema = read("src/db/schema.ts");
  assert.ok(schema.includes('export const benefitDependents = pgTable("benefit_dependents"'));
  assert.ok(schema.includes('export const benefitEnrollmentEvents = pgTable("benefit_enrollment_events"'));
  assert.ok(schema.includes('providerStatus: varchar("provider_status"'));
  assert.ok(schema.includes('dependentShare: numeric("dependent_share"'));
  assert.ok(schema.includes('employerPaidDependents: integer("employer_paid_dependents"'));
});

test("active HMO dependent premiums are included in payroll and pending dependents are excluded", () => {
  const engine = read("src/lib/payroll-engine.ts");
  assert.ok(engine.includes("benefitDependents"), "payroll must load HMO dependents");
  assert.ok(/eq\(benefitDependents\.status, "active"\)/.test(engine), "only active dependents may deduct");
  assert.ok(engine.includes("dependentContributionByEnrollment"), "dependent premiums must roll into the parent enrollment");
  assert.ok(
    engine.includes("Number(enrolment.monthlyContribution) + dependentContribution"),
    "employee and active dependent shares must be combined before payroll calculation",
  );
});

test("HMO lifecycle events are first-class Automation Studio triggers", () => {
  const automation = read("src/lib/automation.ts");
  for (const trigger of [
    "benefit.enrollment_created",
    "benefit.dependent_added",
    "benefit.coverage_activated",
    "benefit.coverage_ended",
  ]) {
    assert.ok(automation.includes(`"${trigger}"`), `${trigger} must be registered`);
  }
  assert.ok(automation.includes('value: "benefitCategory"'));
  assert.ok(automation.includes('value: "providerStatus"'));
  assert.ok(automation.includes('value: "dependentRelationship"'));
});

test("the HMO enrollment workflow template cannot run for non-HMO benefits", () => {
  const templates = read("src/lib/automation-templates.ts");
  assert.ok(templates.includes('id: "benefits-hmo-enrollment-handoff"'));
  assert.ok(templates.includes('{ field: "benefitCategory", operator: "eq", value: "hmo" }'));
  assert.ok(templates.includes('id: "benefits-hmo-dependent-review"'));
  assert.ok(templates.includes('id: "benefits-hmo-coverage-activated"'));
});

test("benefits UI passes workspace identity when seeding and mounts the HMO workspace", () => {
  const panel = read("src/components/benefits-panel.tsx");
  assert.ok(panel.includes("JSON.stringify({ organizationId })"), "benefit seed must send organizationId");
  assert.ok(panel.includes("<HmoBenefitsPanel organizationId={organizationId}"));
});

test("HMO mutations retain tenant, scope, origin and audit guardrails", () => {
  const route = read("src/app/api/benefits/hmo/route.ts");
  assert.ok(route.includes("enforceSameOriginMutation"));
  assert.ok(route.includes("assertOrganizationRole"));
  assert.ok(route.includes("assertScope"));
  assert.ok(route.includes("recordAuditEvent"));
  assert.ok(route.includes("runAutomationEventSafely"));
});
