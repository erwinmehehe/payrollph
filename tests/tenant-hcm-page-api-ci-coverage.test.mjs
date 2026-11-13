/**
 * Regression guard for fictional PostgreSQL 16 HCM page + API isolation proofs.
 *
 * A page-specific workflow must rerun when its route, client projection,
 * shared session/role policy, query validation or schema changes.
 * This is CI trigger coverage only: no page or API isolation credits.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const guardPath = "tests/tenant-hcm-page-api-ci-coverage.test.mjs";
const common = [
  guardPath,
  "src/lib/access.ts",
  "src/lib/auth.ts",
  "src/lib/permissions.ts",
  "src/lib/organization-auth-policy.ts",
  "src/lib/critical-release-flags.ts",
  "src/db/schema.ts",
  "scripts/qa/tenant-table-http.mjs",
];

const suites = [
  {
    name: "Action Center",
    workflow: ".github/workflows/tenant-hcm-action-center-qa.yml",
    contract: "tests/tenant-hcm-action-center-contract.test.mjs",
    required: [
      "src/app/hcm/action-center/page.tsx",
      "src/app/api/hcm/business-processes/inbox/route.ts",
      "src/lib/hcm-people-home-worklist.ts",
      "src/lib/hcm-people-home-scope.ts",
      "src/lib/hcm-business-process-read.ts",
      "src/lib/hcm-business-process.ts",
      "src/lib/security-request.ts",
      "src/lib/billing.ts",
      "src/lib/audit.ts",
      "src/lib/hcm-action-center.ts",
      "src/components/hcm-business-process-inbox.tsx",
    ],
  },
  {
    name: "My Team",
    workflow: ".github/workflows/tenant-hcm-my-team-qa.yml",
    contract: "tests/tenant-hcm-my-team-contract.test.mjs",
    required: [
      "src/app/hcm/my-team/page.tsx",
      "src/app/api/hcm/my-team/route.ts",
      "src/lib/hcm-my-team-server.ts",
      "src/lib/hcm-my-team-contract.ts",
      "src/lib/hcm-read-scope-validation.ts",
      "src/lib/hcm-scoped-read-validation.ts",
      "src/lib/hcm-scoped-read-failure.ts",
      "src/components/hcm-my-team.tsx",
    ],
  },
  {
    name: "Organization Explorer",
    workflow: ".github/workflows/tenant-hcm-org-explorer-page-qa.yml",
    contract: "tests/tenant-hcm-org-explorer-page-contract.test.mjs",
    required: [
      "src/app/hcm/org-explorer/**",
      "src/app/api/hcm/org-explorer/**",
      "src/app/api/hcm/position-history/**",
      "src/lib/hcm-org-explorer-*.ts",
      "src/lib/hcm-enterprise-plan-policy.ts",
      "src/lib/hcm-scoped-read-validation.ts",
      "src/lib/hcm-scoped-read-failure.ts",
      "src/components/hcm-org-explorer.tsx",
    ],
  },
  {
    name: "Team Leave Calendar",
    workflow: ".github/workflows/tenant-team-leave-qa.yml",
    contract: "tests/tenant-team-leave-contract.test.mjs",
    required: [
      "src/app/hcm/team-leave-calendar/page.tsx",
      "src/app/api/hcm/team-leave-calendar/route.ts",
      "src/lib/hcm-team-leave-calendar-server.ts",
      "src/lib/hcm-team-leave-calendar-contract.ts",
      "src/lib/hcm-read-scope-validation.ts",
      "src/lib/hcm-scoped-read-validation.ts",
      "src/lib/hcm-scoped-read-failure.ts",
      "src/components/hcm-team-leave-calendar.tsx",
    ],
  },
];

/**
 * Source-order guard complements the existing real HTTP proof: a future edit
 * must not move private SQL/client mounting ahead of selected-employer checks.
 * These assertions do not replace runtime role, revoked-session or SQL proofs.
 */
const authorizationOrder = [
  ["Action Center SSR", "src/app/hcm/action-center/page.tsx", [
    "const user = await getSessionUser()",
    "explicitHcmEmployerId(requested)",
    "await assertOrganizationRole(user.id, organizationId",
    "await getAccess(user.id, organizationId)",
    "await db.select({ name: organizations.name })",
    "await loadPeopleHomeWorklist(organizationId",
  ]],
  ["My Team SSR", "src/app/hcm/my-team/page.tsx", [
    "const user = await getSessionUser()",
    "positiveId(params.organizationId)",
    "await assertOrganizationRole(",
    "await getAccess(user.id, organizationId)",
    "deriveMyTeamScope(access)",
    "<HcmMyTeamClient",
  ]],
  ["My Team API", "src/app/api/hcm/my-team/route.ts", [
    "const user = await getSessionUser()",
    'parseId(params.get("organizationId"))',
    "await assertOrganizationRole(",
    "await getAccess(user.id, organizationId)",
    "deriveMyTeamScope(access)",
    "await loadHcmMyTeam({",
  ]],
  ["Org Explorer SSR", "src/app/hcm/org-explorer/page.tsx", [
    "const user = await getSessionUser()",
    "hcmOrgExplorerPositiveId(",
    "await denyHcmOrgExplorer(user.id, organizationId)",
    "await getAccess(user.id, organizationId)",
    "<HcmOrgExplorerClient",
  ]],
  ["Org Explorer API", "src/app/api/hcm/org-explorer/route.ts", [
    "const user = await getSessionUser()",
    'hcmOrgExplorerSingleQueryId(params, "organizationId")',
    "await denyHcmOrgExplorer(user.id, organizationId)",
    "await loadHcmOrgExplorer(organizationId)",
  ]],
  ["Position History API", "src/app/api/hcm/position-history/route.ts", [
    "const user = await getSessionUser()",
    'hcmOrgExplorerSingleQueryId(params, "organizationId")',
    'hcmOrgExplorerSingleQueryId(params, "positionId")',
    "await denyHcmOrgExplorer(user.id, organizationId)",
    "await loadHcmPositionHistory(organizationId, positionId)",
  ]],
  ["Team Leave SSR", "src/app/hcm/team-leave-calendar/page.tsx", [
    "const user = await getSessionUser()",
    "positiveId((await searchParams).organizationId)",
    "await assertOrganizationRole(",
    "await getAccess(user.id, organizationId)",
    "deriveTeamLeaveScope(access)",
    "<HcmTeamLeaveCalendar",
  ]],
  ["Team Leave API", "src/app/api/hcm/team-leave-calendar/route.ts", [
    "const user = await getSessionUser()",
    'positiveId(params.get("organizationId"))',
    "await assertOrganizationRole(",
    "await getAccess(user.id, organizationId)",
    "deriveTeamLeaveScope(access)",
    "await loadTeamLeaveMonth({",
  ]],
  ["Action Center Inbox API", "src/app/api/hcm/business-processes/inbox/route.ts", [
    "const user = await getSessionUser()",
    "getAccess(user.id, organizationId)",
    "await db.select({",
    "eq(hcmBusinessProcessInstances.organizationId, organizationId)",
  ]],
  ["Action Center Inbox POST", "src/app/api/hcm/business-processes/inbox/route.ts", [
    "export async function POST(request: Request)",
    "enforceSameOriginMutation(request)",
    "if (originDenied) return originDenied;",
    "const user = await getSessionUser()",
    "await request.json()",
    "const access = await getAccess(user.id, organizationId)",
    "if (!access) return Response.json(",
    "const [row] = await db.select({",
    "eq(hcmBusinessProcessInstanceSteps.organizationId, organizationId)",
    "eq(hcmBusinessProcessInstances.organizationId, organizationId)",
  ]],
];

for (const [label, path, ordered] of authorizationOrder) {
  test(label + " keeps session, tenant and role checks ahead of private data", () => {
    const source = readFileSync(path, "utf8");
    let previous = -1;
    for (const marker of ordered) {
      const next = source.indexOf(marker, previous + 1);
      assert.ok(next > previous,
        label + ": authorization/data order drift at " + marker);
      previous = next;
    }
  });
}

function workflowPaths(source) {
  const match = source.match(/^    paths:\n((?:      - [^\n]+\n)+)/m);
  assert.ok(match, "Missing path-scoped pull_request trigger");
  return new Set(match[1].trim().split("\n").map((line) => {
    const item = line.trim();
    assert.match(item, /^- "[^"]+"$/, "Use explicit quoted trigger paths");
    return item.slice(3, -1);
  }));
}

for (const suite of suites) {
  test(suite.name + " CI reruns on tenant authorization and page/API changes", () => {
    const workflow = readFileSync(suite.workflow, "utf8");
    const watched = workflowPaths(workflow);
    for (const path of [...common, ...suite.required]) {
      assert.ok(watched.has(path), suite.name + ": missing CI trigger for " + path);
    }
    assert.ok(workflow.includes("pull_request:"), suite.name + ": PR trigger required");
    assert.ok(workflow.includes("branches: [main]"), suite.name + ": main-target PR required");
    assert.ok(workflow.includes("image: postgres:16"), suite.name + ": real PG16 required");
    assert.ok(workflow.includes("BUILD_BLOCK_ACCEPTANCE_MODE:"), suite.name + ": synthetic-only mode required");
    assert.ok(workflow.includes("PAYMONGO_DISBURSEMENTS_ENABLED:"), suite.name + ": payment provider must stay disabled");
    assert.ok(workflow.includes("ref: ${{ github.event.pull_request.head.sha || github.sha }}"),
      suite.name + ": exact PR-head checkout required");
    assert.ok(workflow.includes("node --test " + suite.contract), suite.name + ": existing negative contract required");
    assert.ok(workflow.includes("node --test " + guardPath), suite.name + ": this drift guard must run");
  });
}

test("the four independent page proofs stay separate and do not grant isolation credits", () => {
  assert.equal(new Set(suites.map((suite) => suite.workflow)).size, 4);
  for (const suite of suites) {
    const workflow = readFileSync(suite.workflow, "utf8");
    assert.match(workflow, /node --import tsx scripts\/qa\/tenant-[a-z-]+-http\.mjs/,
      suite.name + ": actual disposable HTTP proof remains a separate step");
    assert.doesNotMatch(workflow, /productionCertified:\s*true|pageActionCredits:\s*[1-9]/,
      suite.name + ": CI does not certify production or promote coverage");
  }
});
