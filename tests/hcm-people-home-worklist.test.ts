import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("People Home aggregates only source-owned work, never creates approvals or pay changes", () => {
  const projection = read("src/lib/hcm-people-home-worklist.ts");
  assert.match(projection, /loadPeopleOperationsInbox/);
  assert.match(projection, /canDecide\(organizationId, item.assignee, user.name, user.id\)/);
  assert.match(projection, /assigned_owner_user_id = \$2/);
  assert.match(projection, /Promise.allSettled/);
  assert.match(projection, /state: "unavailable"/);
  assert.match(projection, /const BP_CANDIDATE_LIMIT = 30/);
  assert.match(projection, /limit\(BP_CANDIDATE_LIMIT \+ 1\)/);
  assert.match(projection, /LIMIT \$3/);
  assert.match(projection, /eq\(hcmBusinessProcessInstances.organizationId, organizationId\)/);
  assert.match(projection, /eq\(hcmBusinessProcessInstanceSteps.organizationId, organizationId\)/);
  assert.match(projection, /blockedByMakerChecker:/);
  for (const privateField of [
    "salary", "bankAccount", "basicRate", "governmentId", "tinNo",
    "firstName", "lastName", "decisionNote", "performanceScore", "employeeNo",
  ]) {
    assert.ok(!projection.includes(privateField), "Unexpected private field: " + privateField);
  }
  for (const mutation of ["db.update(", "db.insert(", "db.delete(", "pool.query(\"UPDATE", "fetch("]) {
    assert.ok(!projection.includes(mutation), "Unexpected mutation: " + mutation);
  }
});

test("People Home distinguishes source checks from user-assigned decisions", () => {
  const page = read("src/app/hcm/command-center/page.tsx");
  const projection = read("src/lib/hcm-people-home-worklist.ts");
  assert.match(page, /loadPeopleHomeWorklist\(organizationId, \{ id: user.id, name: user.name \}\)/);
  assert.ok(page.indexOf("assertOrganizationRole(user.id") < page.indexOf("loadPeopleHomeWorklist(organizationId"));
  assert.match(page, /My HCM decisions/);
  assert.match(page, /People Ops follow-ups/);
  assert.match(page, /Cases assigned to me/);
  assert.match(page, /Source unavailable/);
  assert.match(projection, /Optional source check/);
  assert.match(projection, /items: items.slice\(0, VISIBLE\)/);
  assert.match(projection, /hasMore: items.length > VISIBLE \|\| candidates.length > BP_CANDIDATE_LIMIT/);
  assert.match(page, /A separate reviewer is required/);
  assert.ok(!page.includes("payrollRuns"));
});

test("Employer selection and links remain authoritative on deep links and switches", () => {
  const app = read("src/app/app/page.tsx");
  const workspace = read("src/components/linaw-workspace.tsx");
  assert.match(app, /requestedAccess.role === "employee"/);
  assert.match(app, /assertOrganizationSessionPolicy\(user.id, companyOrganizationId\)/);
  assert.match(workspace, /searchParams.get\("workspacePage"\) === "People"/);
  assert.match(workspace, /canOpenPeopleHome\(initialData.access\)/);
  assert.match(workspace, /window.location.assign\("\/app\?organizationId=" \+ id\)/);
  assert.match(workspace, /Number.isSafeInteger\(id\)/);
  assert.match(workspace, /pilotFocusEnabled/);
  assert.ok(!workspace.includes("window.location.assign(\"/hcm/command-center\")"));
});

test("HCM home preserves source ownership and safe preview semantics", () => {
  const projection = read("src/lib/hcm-people-home-worklist.ts");
  assert.match(projection, /sourceUrl: "\/app\?organizationId=" \+ organizationId \+ "&workspacePage=People"/);
  assert.match(projection, /sourceUrl: "\/hcm\/work-items\?organizationId=" \+ organizationId/);
  assert.match(projection, /total: null/);
  assert.match(projection, /A bounded assignment-filtered preview is not a complete task count/);
  assert.ok(!projection.includes("status = 'approved'"));
});
