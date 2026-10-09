import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { hcmBusinessProcessDefinitions, organizations } from "../src/db/schema";
import {
  directPositionAssignmentGovernanceQuery,
  isGovernedPositionAssignmentWorkspace,
  MOVEMENT_TYPES,
} from "../src/lib/hcm-position-assignment-guard";

test("new Hire or Transfer governance closes direct incumbent assignment, even inactive", async () => {
  const [org] = await db.insert(organizations).values({
    name: "HCM direct position assignment test",
    legalName: "HCM direct position assignment test",
    plan: "Core",
  }).returning();
  try {
    assert.equal(await isGovernedPositionAssignmentWorkspace(org.id), false);
    // Approval to create a position alone does not certify that hiring the
    // incumbent is a governed workflow; the types have distinct authority.
    await db.insert(hcmBusinessProcessDefinitions).values({
      organizationId: org.id,
      code: `position-create-${org.id}`,
      name: "Create position approval",
      processType: "create_position",
      effectiveFrom: "2026-01-01",
      steps: [{ type: "approval", label: "People", assignee: "role:owner" }],
    });
    assert.equal(await isGovernedPositionAssignmentWorkspace(org.id), false);
    await db.insert(hcmBusinessProcessDefinitions).values({
      organizationId: org.id,
      code: `hire-inactive-${org.id}`,
      name: "Hire review",
      processType: "hire",
      effectiveFrom: "2099-01-01",
      active: false,
      steps: [{ type: "approval", label: "People", assignee: "role:owner" }],
    });
    assert.equal(await isGovernedPositionAssignmentWorkspace(org.id), true);
    const insideTransaction = await db.transaction(async (tx) => tx.execute(directPositionAssignmentGovernanceQuery(org.id)));
    assert.equal(insideTransaction.rows[0]?.blocked, true);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("governed assignment types cover hiring, job changes, transfers and promotions", () => {
  assert.deepEqual([...MOVEMENT_TYPES].sort(), ["change_job", "hire", "promotion", "transfer"]);
  assert.throws(() => directPositionAssignmentGovernanceQuery(0), /Valid organizationId/);
  assert.throws(() => directPositionAssignmentGovernanceQuery(-2), /Valid organizationId/);
});

test("manual assignment rechecks governance and writes the worker, position and audit atomically", () => {
  const route = readFileSync("src/app/api/workforce-planning/route.ts", "utf8");
  assert.match(route, /await isGovernedPositionAssignmentWorkspace\(organizationId\)/);
  assert.match(route, /Response\.json\(HCM_GOVERNED_POSITION_ASSIGNMENT_REQUIRED, \{ status: 409 \}\)/);
  assert.ok(route.includes("directPositionAssignmentGovernanceQuery(organizationId)"));
  assert.ok(route.includes('action: "hcm-manual-position-assignment"'));
  assert.ok(route.includes('companyAccess?.companyWide'));
  assert.ok(route.includes('requireSensitiveActionMfa(user)'));
  assert.ok(route.includes('pg_advisory_xact_lock(4102'));
  const block = route.slice(route.indexOf('if (entityType === "assignment")'),route.indexOf('entityType must be job_family'));
  assert.ok(block.includes('tx.insert(positionAssignments)'));
  assert.ok(block.includes('tx.update(employees)'));
  assert.ok(block.includes('tx.insert(workerEmploymentEvents)'));
  assert.ok(block.includes('tx.insert(auditEvents)'));
  assert.ok(!block.includes('await recordAuditEvent({'));
});

test("position status cannot be directly re-approved, reopened, or marked filled", () => {
  const route = readFileSync("src/app/api/workforce-planning/route.ts", "utf8");
  const ui = readFileSync("src/components/workforce-planning-panel.tsx", "utf8");
  assert.ok(route.includes('HCM_POSITION_TRANSITION_REQUIRES_WORKFLOW'));
  assert.ok(route.includes('status !== "frozen" || !["approved", "open"].includes(position.status)'));
  assert.ok(route.includes('action: "hcm-position-lifecycle-status"'));
  assert.ok(route.includes('eq(positions.status, freshPosition.status)'));
  assert.ok(route.includes('source: "companywide-mfa-vacancy-freeze"'));
  assert.ok(ui.includes('position.status === "frozen"'));
  assert.ok(ui.includes('["frozen", "closed"]'));
  assert.ok(ui.includes('use Recruitment or the effective-dated HCM workflow'));
});
