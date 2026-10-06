import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const read = (path: string) => readFileSync(path, "utf8");

test("HR site and work arrangements are scoped, MFA protected and audit logged", () => {
  const route = read("src/app/api/workforce/worksites/route.ts");
  assert.ok(route.includes("PEOPLE_ADMIN_ROLES"));
  assert.ok(route.includes("requireSensitiveActionMfa(user)"));
  assert.ok(route.includes("assertScope"));
  assert.ok(route.includes('action === "set_arrangement"'));
  assert.ok(route.includes('action === "authorize_site"'));
  assert.ok(route.includes('action === "deny_site"'));
  assert.ok(route.includes('const decision = action === "deny_site" ? "deny" : "allow"'));
  assert.ok(route.includes("organizationId, employeeId, worksiteId, decision, effectiveFrom"));
  assert.ok(route.includes('"end_authorization"') && route.includes('const authorizationId = Number(body.authorizationId)'));
  assert.ok(route.includes("recordAuditEvent"));
});
test("WFM checks effective site authorization in coverage, claims and manager approval", () => {
  const route = read("src/app/api/workforce/coverage/route.ts");
  const coverage = read("src/lib/workforce-coverage.ts");
  assert.ok(route.includes("loadSiteEligibilityEvidence"));
  assert.ok(route.includes("employeeSiteEligibility"));
  assert.ok(route.includes("siteEvidenceIssues"));
  assert.ok(route.includes("siteIneligibleShiftDefinitionIds"));
  assert.ok(coverage.includes("siteIneligibleHeadcount"));
});
test("explicit roster mutations reject incompatible worksite arrangements", () => {
  const schedules = read("src/app/api/workforce/schedules/route.ts");
  assert.equal(schedules.split("await employeeSiteEligibility(").length - 1, 2);
});
test("site governance remains visible in workforce operations", () => {
  const sites = read("src/components/workspace/workforce-worksites-panel.tsx");
  const coverage = read("src/components/workspace/workforce-coverage-panel.tsx");
  assert.ok(sites.includes("Save work arrangement"));
  assert.ok(sites.includes("Authorize secondary site"));
  assert.ok(sites.includes("Restrict site"));
  assert.ok(sites.includes("Restricted"));
  assert.ok(coverage.includes("siteIneligibleHeadcount"));
});


test("connected worker profile reuses worksite governance evidence", () => {
  const profile = read("src/app/api/hcm/worker-profile/route.ts");
  const people = read("src/components/workspace/people.tsx");
  assert.ok(profile.includes("worksiteGovernance"));
  assert.ok(profile.includes("hcmWorksiteAuthorizations"));
  assert.ok(people.includes("Worksite access"));
});
