import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("Core 3.1 decision catalog is explicit and never encodes automatic regularization or separation", () => {
  const source = read("src/lib/hcm-employment-term-decisions.ts");
  assert.ok(source.includes('"confirm_regular"'));
  assert.ok(source.includes('"renew_term"'));
  assert.ok(source.includes('"extend_term"'));
  assert.ok(source.includes('"convert_terms"'));
  assert.ok(source.includes('"non_renew"'));
  assert.ok(source.includes('"continue_current"'));
  assert.ok(source.includes("autoSeparation: false"));
  assert.ok(source.includes("finalPayTriggered: false"));
});

test("non-renewal produces a separation handoff instead of changing employee status", () => {
  const source = read("src/lib/hcm-employment-term-decisions.ts");
  assert.ok(source.includes('separationHandoffStatus: "ready"'));
  assert.ok(source.includes('eventType: "employment_term_decision"'));
  assert.equal(source.includes('status: "Separated"'), false);
  assert.equal(source.includes('status: "Separating"'), false);
});

test("successor-term decisions reuse governed Core 3 activation", () => {
  const source = read("src/lib/hcm-employment-term-decisions.ts");
  assert.ok(source.includes("activateEmploymentTerm"));
  assert.ok(source.includes('status: "scheduled"'));
  assert.ok(source.includes("successorTermId"));
  assert.ok(source.includes("A separate employment-terms change is already pending or scheduled"));
});

test("decision API enforces four-eyes, MFA and term-specific validation", () => {
  const route = read("src/app/api/hcm/employment-term-decisions/route.ts");
  assert.ok(route.includes("PEOPLE_ADMIN_ROLES"));
  assert.ok(route.includes("requireSensitiveActionMfa(user)"));
  assert.ok(route.includes("requester cannot approve their own employment-term decision"));
  assert.ok(route.includes('decisionKind === "confirm_regular"'));
  assert.ok(route.includes('decisionKind === "non_renew"'));
  assert.ok(route.includes('decisionKind === "convert_terms"'));
});

test("probation and fixed-term successor records require explicit dates", () => {
  const route = read("src/app/api/hcm/employment-term-decisions/route.ts");
  assert.ok(route.includes('resolvedNextTermKind === "probationary"'));
  assert.ok(route.includes("nextProbationReviewDate"));
  assert.ok(route.includes('resolvedNextTermKind === "fixed_term"'));
  assert.ok(route.includes("nextContractEndDate"));
  assert.ok(route.includes("will not infer or extend probation automatically"));
});

test("separation handoff has explicit states and Core 3.2 makes advancement Separation-owned", () => {
  const migration = read("drizzle/0057_hcm_employment_term_decisions.sql");
  const route = read("src/app/api/hcm/employment-term-decisions/route.ts");
  const separation = read("src/app/api/separation/route.ts");
  assert.ok(migration.includes("'none','ready','started','completed'"));
  assert.equal(route.includes('"mark_handoff_started"'), false);
  assert.equal(route.includes('"mark_handoff_completed"'), false);
  assert.ok(separation.includes('separationHandoffStatus: "started"'));
  assert.ok(separation.includes('separationHandoffStatus: "completed"'));
});

test("only one open decision can exist per active employment term", () => {
  const migration = read("drizzle/0057_hcm_employment_term_decisions.sql");
  assert.ok(migration.includes("hcm_employment_term_decisions_open_term_unique"));
  assert.ok(migration.includes("'pending_approval','scheduled'"));
});

test("decision scheduler applies only approved due decisions", () => {
  const source = read("src/lib/hcm-employment-term-decisions.ts");
  assert.ok(source.includes("runScheduledEmploymentTermDecisions"));
  assert.ok(source.includes('eq(hcmEmploymentTermDecisions.status, "scheduled")'));
  assert.ok(source.includes("lte(hcmEmploymentTermDecisions.effectiveDate, today)"));
});
