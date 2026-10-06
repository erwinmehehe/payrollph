import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { employmentTermLifecycle } from "../src/lib/hcm-employment-terms";

const read = (path: string) => readFileSync(path, "utf8");

test("employment terms lifecycle surfaces probation review without automatic regularization", () => {
  const result = employmentTermLifecycle({
    termKind: "probationary",
    probationReviewDate: "2026-10-10",
  }, "2026-10-06");
  assert.equal(result.state, "upcoming");
  assert.equal(result.daysUntil, 4);
  assert.match(result.action ?? "", /governed employment change/i);
});

test("fixed-term end becomes an action warning rather than automatic separation", () => {
  const result = employmentTermLifecycle({
    termKind: "fixed_term",
    contractEndDate: "2026-10-05",
  }, "2026-10-06");
  assert.equal(result.state, "overdue");
  assert.match(result.action ?? "", /Separation workflow/);
});

test("employment terms API enforces four-eyes, MFA, scheduling and explicit lifecycle dates", () => {
  const route = read("src/app/api/hcm/employment-terms/route.ts");
  assert.ok(route.includes("PEOPLE_ADMIN_ROLES"));
  assert.ok(route.includes("requireSensitiveActionMfa(user)"));
  assert.ok(route.includes("requester cannot approve their own employment terms"));
  assert.ok(route.includes('termKind === "probationary"'));
  assert.ok(route.includes('termKind === "fixed_term"'));
  assert.ok(route.includes('status: "scheduled"'));
  assert.ok(route.includes("activateEmploymentTerm"));
});

test("employment terms activation updates payroll-facing classification and immutable worker history", () => {
  const source = read("src/lib/hcm-employment-terms.ts");
  assert.ok(source.includes("employmentType: term.employmentType"));
  assert.ok(source.includes('eventType: "employment_terms_change"'));
  assert.ok(source.includes("autoSeparation: false"));
  assert.ok(source.includes("autoRegularization: false"));
  assert.ok(source.includes("runScheduledEmploymentTerms"));
});

test("Core 3 employment terms are effective-dated and one active/open record is enforced per worker", () => {
  const migration = read("drizzle/0056_hcm_employment_terms.sql");
  assert.ok(migration.includes('"effective_from" date NOT NULL'));
  assert.ok(migration.includes('"probation_review_date" date'));
  assert.ok(migration.includes('"contract_end_date" date'));
  assert.ok(migration.includes("hcm_employment_terms_active_employee_unique"));
  assert.ok(migration.includes("hcm_employment_terms_open_employee_unique"));
});

test("connected worker profile exposes terms history and lifecycle state", () => {
  const profile = read("src/app/api/hcm/worker-profile/route.ts");
  assert.ok(profile.includes("hcmEmploymentTerms"));
  assert.ok(profile.includes("employmentTerms: {"));
  assert.ok(profile.includes("employmentTermsLifecycleState"));
});

test("scheduler activates approved due terms but does not terminate employees at an end date", () => {
  const scheduler = read("src/lib/scheduler.ts");
  const terms = read("src/lib/hcm-employment-terms.ts");
  assert.ok(scheduler.includes("runScheduledEmploymentTerms"));
  assert.ok(terms.includes('eq(hcmEmploymentTerms.status, "scheduled")'));
  assert.equal(terms.includes('status: "Separated"'), false);
});
