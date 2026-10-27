import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("People Home aggregates only source-owned work, never creates approvals or pay changes", () => {
  const projection = read("src/lib/hcm-people-home-worklist.ts");
  assert.match(projection, /loadPeopleHomeAssigneePermissions/);
  assert.match(projection, /assertOrganizationRole\(user.id, organizationId, PEOPLE_ADMIN_ROLES\)/);
  assert.match(projection, /getAccess\(user.id, organizationId\)/);
  assert.match(projection, /peopleHomeEnabledForOrganization\(organizationId\)/);
  assert.match(projection, /if \(denied \|\| !canOpenPeopleHome\(access\)\)/);
  assert.ok(!projection.includes("loadPeopleOperationsInbox"), "People Home must not load unbounded People Ops sources");
  assert.match(projection, /const permissions = await loadPeopleHomeAssigneePermissions/);
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
  assert.match(projection, /recordedSourceDate\(item.dueDate\)/);
  assert.match(projection, /incompleteEvidence: true/);
  assert.match(projection, /items: items.slice\(0, VISIBLE\)/);
  assert.match(projection, /hasMore: items.length > VISIBLE \|\| partial/);
  assert.match(projection, /limit\(FOLLOWUP_SOURCE_LIMIT \+ 1\)/);
  assert.match(projection, /partial: true/);
  assert.match(page, /A separate reviewer is required/);
  assert.match(page, /Other work, including additional source categories/);
  assert.match(page, /Source milestone:/);
  assert.match(page, /Workflow deadline:/);
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
  assert.match(workspace, /expandHcmInbox={searchParams.get\("hcmPanel"\) === "bp"}/);
  const people = read("src/components/workspace/people.tsx");
  assert.ok(people.includes("open={administrationOpen}"));
  assert.ok(people.includes("onToggle={(event) => setAdministrationOpen(event.currentTarget.open)}"));
  assert.ok(!workspace.includes("window.location.assign(\"/hcm/command-center\")"));
});

test("HCM home preserves source ownership and safe preview semantics", () => {
  const projection = read("src/lib/hcm-people-home-worklist.ts");
  assert.match(projection, /sourceUrl: "\/app\?organizationId=" \+ organizationId \+ "&workspacePage=People&hcmPanel=bp"/);
  assert.match(projection, /sourceUrl: "\/hcm\/work-items\?organizationId=" \+ organizationId/);
  assert.match(projection, /total: null/);
  assert.match(projection, /A bounded assignment-filtered preview is not a complete task count/);
  assert.ok(!projection.includes("status = 'approved'"));
});


test("All People Home query workloads are tenant-qualified, capped and private", () => {
  const projection = read("src/lib/hcm-people-home-worklist.ts");
  const batchedRoles = read("src/lib/delegation.ts");
  assert.match(projection, /const BP_CANDIDATE_LIMIT = 30/);
  assert.match(projection, /const FOLLOWUP_SOURCE_LIMIT = 6/);
  assert.match(projection, /eq\(hcmLifecycleNotificationTasks.organizationId, organizationId\)/);
  assert.match(projection, /eq\(provisioningTasks.organizationId, organizationId\)/);
  assert.match(projection, /eq\(hcmBusinessProcessInstances.organizationId, organizationId\)/);
  assert.match(projection, /eq\(hcmBusinessProcessInstanceSteps.organizationId, organizationId\)/);
  assert.match(projection, /WHERE organization_id = \$1 AND assigned_owner_user_id = \$2/);
  assert.match(projection, /LIMIT \$3/);
  assert.match(batchedRoles, /eq\(approvalDelegations.organizationId, organizationId\)/);
  assert.match(batchedRoles, /eq\(userOrganizations.organizationId, organizationId\)/);
  assert.match(batchedRoles, /eq\(userOrganizations.active, true\)/);
  assert.match(batchedRoles, /gte\(approvalDelegations.endsOn, onDate\)/);
  assert.match(batchedRoles, /limit\(PEOPLE_HOME_DELEGATION_LIMIT \+ 1\)/);
  assert.match(batchedRoles, /delegations.length > PEOPLE_HOME_DELEGATION_LIMIT/);
  assert.ok(!projection.includes("db.select().from("));
  assert.ok(!projection.includes("loadEmploymentLifecycleReadiness"));
  assert.ok(!projection.includes("employeeName"));
  assert.ok(!projection.includes("netPay"));
  assert.match(projection, /sourceDate: null/);
  assert.match(projection, /total: null/);
});

test("People Home source links offer visible keyboard focus and large touch targets", () => {
  const page = read("src/app/hcm/command-center/page.tsx");
  const sourceItem = page.match(/<Link href=\{item\.sourceUrl\} className="([^"]+)"/)?.[1];
  const sourceSection = page.match(/<Link className="([^"]+)"\s+href=\{section\.sourceUrl\}/)?.[1];
  const returnLink = page.match(/<Link href=\{`\/app\?organizationId=\$\{organizationId\}`\} className="([^"]+)">Back to selected employer workspace/)?.[1];
  for (const [label, classes] of [
    ["source-item", sourceItem],
    ["source-section", sourceSection],
    ["return", returnLink],
  ] as const) {
    assert.ok(classes, label + " link is present");
    assert.match(classes, /\bmin-h-11\b/, label + " is a 44px minimum touch target");
    assert.match(classes, /\bfocus-visible:outline-2\b/, label + " has visible keyboard focus");
    assert.match(classes, /\bfocus-visible:outline-offset-2\b/);
  }
});
