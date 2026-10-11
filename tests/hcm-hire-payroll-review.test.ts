import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildHirePayrollInputReview, hirePayrollReviewEnabledForEmployer,
} from "../src/lib/hcm-hire-payroll-review";

const flags = {
  HCM_HIRE_PAYROLL_REVIEW_ENABLED: "true",
  NEXT_PUBLIC_HCM_HIRE_PAYROLL_REVIEW_ENABLED: "true",
  HCM_HIRE_PAYROLL_REVIEW_ORG_IDS: "17, 18",
};
const completeInput = {
  organizationId: 17,
  employeeId: 23,
  observedAt: "2026-10-11T07:00:00.000Z",
  employee: {
    active: true,
    statutoryIdsRecorded: true,
    payoutDetailsRecorded: true,
    restDayRecorded: true,
  },
  payProfile: {
    basisRecognized: true,
    ratePositive: true,
    standardDaysPositive: true,
    standardHoursPositive: true,
  },
  recordedOnboardingTasks: [{ done: true }, { done: true }],
  onboardingPreviewHasMore: false,
};

test("hire-to-payroll evidence is disabled unless both flags and the exact employer allowlist agree", () => {
  assert.equal(hirePayrollReviewEnabledForEmployer(17, {}), false);
  assert.equal(hirePayrollReviewEnabledForEmployer(17, flags), true);
  assert.equal(hirePayrollReviewEnabledForEmployer(18, flags), true);
  assert.equal(hirePayrollReviewEnabledForEmployer(19, flags), false);
  assert.equal(hirePayrollReviewEnabledForEmployer(17, {
    ...flags, HCM_HIRE_PAYROLL_REVIEW_ENABLED: "false",
  }), false);
  assert.equal(hirePayrollReviewEnabledForEmployer(17, {
    ...flags, NEXT_PUBLIC_HCM_HIRE_PAYROLL_REVIEW_ENABLED: "false",
  }), false);
  for (const value of ["017", "17x", "17.0", "0", "-17", "9007199254740992"]) {
    assert.equal(hirePayrollReviewEnabledForEmployer(17, {
      ...flags, HCM_HIRE_PAYROLL_REVIEW_ORG_IDS: value,
    }), false, "Reject ambiguous/noncanonical allowlist item: " + value);
  }
  for (const id of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(hirePayrollReviewEnabledForEmployer(id, flags), false);
  }
});

test("all source fields recorded never grants payroll approval or claims verification", () => {
  const model = buildHirePayrollInputReview(completeInput);
  assert.equal(model.organizationId, 17);
  assert.equal(model.employeeId, 23);
  assert.equal(model.payrollAuthorized, false);
  assert.equal(model.incompleteEvidence, true);
  assert.equal(model.sections.length, 8);
  assert.deepEqual(model.sections.filter((item) => item.state === "recorded").map((item) => item.key), [
    "employment", "onboarding", "pay_profile", "government_ids", "payout", "rest_day",
  ]);
  assert.deepEqual(model.sections.filter((item) => item.state === "not_assessed").map((item) => item.key),
    ["attendance", "payroll_approval"]);
  assert.ok(model.sections.every((item) => !/approved pay|verified bank|filing certified/i.test(item.detail)));
  assert.ok(model.sections.find((item) => item.key === "onboarding")?.detail.includes("not independently verify"));
});

test("a checked checklist cannot compensate for missing payroll input evidence", () => {
  const model = buildHirePayrollInputReview({
    ...completeInput,
    employee: {
      active: false, statutoryIdsRecorded: false,
      payoutDetailsRecorded: false, restDayRecorded: false,
    },
    payProfile: null,
  });
  const state = Object.fromEntries(model.sections.map((item) => [item.key, item.state]));
  assert.equal(state.onboarding, "recorded");
  assert.equal(state.employment, "needs_review");
  assert.equal(state.government_ids, "needs_review");
  assert.equal(state.payout, "needs_review");
  assert.equal(state.pay_profile, "needs_review");
  assert.equal(state.rest_day, "needs_review");
  assert.equal(state.payroll_approval, "not_assessed");
  assert.equal(model.payrollAuthorized, false);
});

test("no onboarding source, incomplete pay fields and open tasks remain distinct", () => {
  const empty = buildHirePayrollInputReview({
    ...completeInput, recordedOnboardingTasks: [],
  });
  assert.equal(empty.sections.find((item) => item.key === "onboarding")?.state, "not_recorded");
  const open = buildHirePayrollInputReview({
    ...completeInput, recordedOnboardingTasks: [{ done: false }, { done: true }],
    payProfile: { ...completeInput.payProfile, standardHoursPositive: false },
  });
  assert.equal(open.sections.find((item) => item.key === "onboarding")?.state, "needs_review");
  assert.equal(open.sections.find((item) => item.key === "pay_profile")?.state, "needs_review");
  const partial = buildHirePayrollInputReview({
    ...completeInput, recordedOnboardingTasks: [{ done: true }],
    onboardingPreviewHasMore: true,
  });
  assert.equal(partial.sections.find((item) => item.key === "onboarding")?.state, "partial");
  assert.equal(partial.onboardingPreviewHasMore, true);
  assert.equal(partial.payrollAuthorized, false);
  for (const id of [-1, 0, 1.1, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => buildHirePayrollInputReview({ ...completeInput, employeeId: id }));
    assert.throws(() => buildHirePayrollInputReview({ ...completeInput, organizationId: id }));
  }
});

test("route is feature-gated and authorized before any source reads; review never mutates payroll", () => {
  const page = readFileSync("src/app/hcm/hire-payroll-review/page.tsx", "utf8");
  const server = readFileSync("src/lib/hcm-hire-payroll-review-server.ts", "utf8");
  const app = readFileSync("src/app/app/page.tsx", "utf8");
  const onboard = readFileSync("src/components/hris-onboarding-checklist.tsx", "utf8");
  const workspace = readFileSync("src/components/linaw-workspace.tsx", "utf8");
  assert.match(page, /hirePayrollReviewEnabledForEmployer\(organizationId\)/);
  assert.match(page, /pilotFocusEnabledForOrganization\(organizationId\)/);
  assert.match(page, /assertOrganizationRole\(/);
  assert.match(page, /getAccess\(user.id, organizationId\)/);
  assert.match(page, /access\?\.companyWide/);
  assert.match(page, /\["owner", "admin", "hr"\]/);
  assert.ok(page.indexOf("assertOrganizationRole(") < page.indexOf("loadHirePayrollInputReview("));
  assert.match(page, /notFound\(\)/);
  assert.match(page, /unavailable = true/);
  assert.match(app, /allowHirePayrollReview = !pilotFocusEnabled/);
  assert.match(app, /assertOrganizationRole\(user.id, companyOrganizationId, PEOPLE_ADMIN_ROLES\)/);
  assert.match(workspace, /allowHirePayrollReview=\{allowHirePayrollReview && !demoRole\}/);
  assert.match(onboard, /allowHirePayrollReview && \(/);
  assert.ok(onboard.includes("/hcm/hire-payroll-review?organizationId="));

  for (const tenantPredicate of [
    "eq(employees.organizationId, organizationId)",
    "eq(employees.id, employeeId)",
    "eq(employeePayProfiles.organizationId, organizationId)",
    "eq(employeePayProfiles.employeeId, employeeId)",
    "eq(provisioningTasks.organizationId, organizationId)",
    "eq(provisioningTasks.employeeId, employeeId)",
  ]) assert.ok(server.includes(tenantPredicate), "Missing tenant/worker source predicate: " + tenantPredicate);
  assert.match(server, /limit\(ONBOARDING_PREVIEW_LIMIT \+ 1\)/);
  assert.match(server, /sql<boolean>/);
  for (const unsafe of ["db.update(", "db.insert(", "db.delete(", "ensureEmployeePayProfiles(", "ensureLeavePayrollSchema("]) {
    assert.ok(!server.includes(unsafe), "Preview must not mutate or initialize source schema: " + unsafe);
    assert.ok(!page.includes(unsafe), "Page must not mutate or initialize schema: " + unsafe);
  }
  for (const leaked of ["{worker.bankAccount}", "{worker.tin}", "{worker.rateAmount}"]) {
    assert.ok(!page.includes(leaked));
  }
});
