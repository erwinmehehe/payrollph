import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Source-contract and negative-control integrity gates, not independent
// tenant-security acceptance. The real fault injection runs in tenant-table
// proof against a disposable PG16 + localhost Next.js server.
const route = readFileSync("src/app/api/workforce-planning/scenarios/route.ts", "utf8");
const rows = readFileSync("scripts/qa/tenant-table-rows/write/workforce-planning.mjs", "utf8");
const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const path = "src/app/api/workforce-planning/scenarios/route.ts";

function postHandler() {
  const start = route.indexOf("export async function POST(request: Request) {");
  const end = route.indexOf("export async function PATCH(request: Request) {", start);
  assert.ok(start >= 0 && end > start, "the POST must remain separate from GET/PATCH");
  return route.slice(start, end);
}

function atomicSection(post) {
  const start = post.indexOf("const created = await db.transaction(async (tx) => {");
  const end = post.indexOf("      return created;\n    });", start);
  assert.ok(start > 0 && end > start, "POST must return the committed scenario transaction");
  return post.slice(start, end + "      return created;\n    });".length);
}

test("scenario INSERT and its employer-scoped audit receipt commit or roll back together", () => {
  const post = postHandler();
  const tx = atomicSection(post);
  assert.match(tx, /const \[created\] = await tx\.insert\(workforcePlanningScenarios\)\.values\(\{/);
  assert.match(tx, /organizationId,\s*planId,\s*name,\s*version,/);
  assert.match(tx, /await recordAuditEvent\(\{[\s\S]*?action: "Workforce staffing scenario saved",[\s\S]*?\}, tx\);/);
  assert.ok(tx.indexOf("await tx.insert(workforcePlanningScenarios)") < tx.indexOf("await recordAuditEvent({"),
    "never write audit evidence before the owned scenario exists");
  assert.doesNotMatch(post, /await db\.insert\(workforcePlanningScenarios\)/,
    "scenario rows must not be written outside their audit transaction");
  assert.doesNotMatch(post.slice(post.indexOf("      return created;\n    });") + 28),
    /await recordAuditEvent\(/, "audit must not run after the scenario transaction");
  assert.match(post, /error: "Scenario could not be calculated\."[\s\S]*status: 422/,
    "unexpected SQL errors must not disclose tenant details");
});

test("regressions removing the shared transaction writer fail the source contract", () => {
  const tx = atomicSection(postHandler());
  const guard = (candidate) => assert.match(candidate,
    /await recordAuditEvent\(\{[\s\S]*?action: "Workforce staffing scenario saved",[\s\S]*?\}, tx\);/);
  guard(tx);
  assert.throws(() => guard(tx.replace("      }, tx);", "      });")), /did not match/);
  assert.throws(() => assert.match(tx.replace("await tx.insert(workforcePlanningScenarios)",
    "await db.insert(workforcePlanningScenarios)"), /await tx\.insert\(workforcePlanningScenarios\)/), /did not match/);
});

test("disposable PG16 proof faults audit INSERT after an owned success and verifies both employers", () => {
  const start = rows.indexOf('const auditVetoName = c.marker + " QA_WFP_AUDIT_VETO";');
  const finish = rows.indexOf('auditInsertRollbackProven: true', start);
  assert.ok(start > 0 && finish > start, "audit-failure negative control must be inside scenario POST exercise");
  const proof = rows.slice(start, finish);
  for (const required of [
    "pre-veto scenario and audit positive",
    "beforeAuditControl.audit.length + 1",
    "requireTenantTableDisposable();",
    "to_regprocedure('public.qa_wfp_scenario_audit_veto_fn()')",
    "BEFORE INSERT ON audit_events",
    "NEW.organization_id = ",
    "NEW.action = 'Workforce staffing scenario saved'",
    "forced audit INSERT failure",
    'error: "Scenario could not be calculated."',
    "scenarioState(c.orgId), beforeAuditVeto",
    "scenarioState(c.victim.org.id), victimBefore",
    "DROP TRIGGER qa_wfp_scenario_audit_veto ON audit_events",
    "DROP FUNCTION public.qa_wfp_scenario_audit_veto_fn()",
  ]) assert.ok(proof.includes(required), "missing fault proof/control: " + required);
  assert.match(proof, /finally \{[\s\S]*?auditVetoTriggerCreated[\s\S]*?auditVetoFunctionCreated/,
    "temporary rejection objects must be cleaned up even on failure");
});

test("no unreviewed credit or relaxation of previously tested GET/PATCH", () => {
  const routeEntry = manifest.allApiRouteFiles[path];
  assert.deepEqual(routeEntry.methods.map(({ name, status }) => ({ name, status })), [
    { name: "GET", status: "COVERED" },
    { name: "POST", status: "GAP" },
    { name: "PATCH", status: "COVERED" },
  ]);
  const post = routeEntry.methods[1];
  assert.equal(post.testedBy, null, "no proof-only PR may promote itself");
  assert.equal(post.reviewedUncertified.coverageCredits, 0);
  assert.equal(post.reviewedUncertified.independentSecurityReview, "PENDING");
  assert.equal(post.reviewedUncertified.productionCertified, false);
  assert.equal(manifest.metrics.coveredAfter + manifest.metrics.publicByDesign + manifest.metrics.gap,
    manifest.metrics.methods);
});
