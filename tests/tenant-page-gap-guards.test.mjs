import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// Source-order regression only; this is not a real HTTP/PG16 isolation receipt.
const read = path => readFileSync(path, "utf8");
const gapPaths = Object.freeze([
  "src/app/app/engagement/page.tsx",
  "src/app/app/goals-reviews/page.tsx",
  "src/app/billing/setup/page.tsx",
  "src/app/careers/page.tsx",
  "src/app/hcm/action-center/page.tsx",
  "src/app/hcm/hire-payroll-review/page.tsx",
  "src/app/hcm/hr-cases/page.tsx",
  "src/app/hcm/my-team/page.tsx",
  "src/app/hcm/org-explorer/page.tsx",
  "src/app/hcm/process-monitor/page.tsx",
  "src/app/hcm/team-leave-calendar/page.tsx",
  "src/app/hcm/work-items/page.tsx",
  "src/app/self/schedule-receipts/page.tsx",
  "src/app/workspace/2316/page.tsx",
  "src/app/workspace/prior-employer/page.tsx",
  "src/app/workspace/report-builder/page.tsx",
]);

test("all 16 page/action gaps remain explicit and uncredited", () => {
  const manifest = JSON.parse(read("scripts/qa/tenant-isolation-coverage-manifest.json"));
  assert.deepEqual(manifest.scopedPages.filter(row => row.status === "GAP")
    .map(row => row.path).sort(), [...gapPaths].sort());
  assert.equal(manifest.scopedPages.length, 21);
  assert.ok(manifest.scopedPages.every(row => row.status === "GAP" || row.status === "COVERED"));
});

test("unaccepted private SSR pages use dynamic rendering and server-side auth", () => {
  for (const path of gapPaths) {
    const source = read(path);
    assert.match(source, /export const dynamic = "force-dynamic"/, path);
    if (path === "src/app/careers/page.tsx") {
      // Public publication-only Careers is not supposed to require a tenant login.
      assert.match(source, /publishedCareersPredicate\(organizationId\)/);
      assert.match(source, /typeof raw !== "string"/);
      assert.match(source, /Number\.isSafeInteger\(organizationId\)/);
      continue;
    }
    assert.match(source, /getSessionUser\(/, path + ": session guard missing");
    assert.match(source, /assertOrganizationRole\(|assertMembership\(|denyHcmOrgExplorer\(|getAccess\(/,
      path + ": page has no recognizable server-side authorization");
  }
});

test("HR Cases refuses a foreign employer before access lookup and client mount", () => {
  const source = read("src/app/hcm/hr-cases/page.tsx");
  const selector = source.indexOf('if (typeof raw !== "string"');
  const role = source.indexOf("const denied = await assertOrganizationRole(");
  const refused = source.indexOf("if (denied) notFound()", role);
  const access = source.indexOf("const access = await getAccess(", role);
  const client = source.indexOf("<EmployeeHrCaseStaffQueue");
  assert.ok(selector > 0 && selector < role && role < refused && refused < access && access < client);
  assert.match(source, /PEOPLE_PAYROLL_ROLES/);
  assert.match(source, /hrCaseRoleCanWork\(access\.role, "hr"\)/);
  assert.match(source, /hrCaseRoleCanWork\(access\.role, "payroll"\)/);
  assert.match(source, /canApproveCoe = access\.companyWide/);
});

test("Report Builder authorizes employer before access, SQL name and client mount", () => {
  const source = read("src/app/workspace/report-builder/page.tsx");
  const selector = source.indexOf("explicitReportBuilderEmployerId(params.organizationId)");
  const role = source.indexOf("const denied = await assertOrganizationRole(");
  const refused = source.indexOf("if (denied) notFound()", role);
  const access = source.indexOf("const access = await getAccess(", role);
  const scoped = source.indexOf("if (!access?.companyWide || !roleAllowed(", access);
  const employer = source.indexOf("const [employer] = await db.select(", scoped);
  const client = source.indexOf("<TenantReportBuilder", employer);
  assert.ok(selector > 0 && selector < role && role < refused &&
    refused < access && access < scoped && scoped < employer && employer < client);
  assert.match(source, /if \(!employer\) notFound\(\)/);
});

test("the existing HCM multi-entity embargo still protects HCM page and API routes", () => {
  const proxy = read("src/proxy.ts");
  const hold = read("src/lib/multi-entity-hcm-hold.ts");
  assert.match(proxy, /path\.startsWith\("\/hcm\/"\)/);
  assert.match(proxy, /path\.startsWith\("\/api\/hcm\/"\)/);
  assert.match(proxy, /multiEntityHcmRequestDeferred\(path, request\.method\)/);
  assert.match(proxy, /ENTITY_HCM_DEFERRED/);
  assert.match(hold, /criticalReleaseFlagEnabled\("multiEntity", env\)/);
});
