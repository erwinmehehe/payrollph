import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  compensationCycles,
  hcmBusinessProcessDefinitions,
  organizations,
} from "../src/db/schema";
import {
  compensationGovernanceQuery,
  isGovernedCompensationWorkspace,
} from "../src/lib/hcm-direct-pay-governance";

test("a configured compensation approval BP blocks direct pay even when disabled/future-dated", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Direct pay HCM BP guard test",
    legalName: "Direct pay HCM BP guard test",
    plan: "Core",
  }).returning();
  try {
    assert.equal(await isGovernedCompensationWorkspace(org.id), false);
    await db.insert(hcmBusinessProcessDefinitions).values({
      organizationId: org.id,
      code: `comp-pay-test-${org.id}`,
      name: "Salary approvals",
      processType: "compensation_change",
      effectiveFrom: "2099-01-01",
      active: false,
      steps: [{ type: "approval", label: "Finance", assignee: "role:owner" }],
    });
    assert.equal(await isGovernedCompensationWorkspace(org.id), true);
    const guarded = await db.transaction(async (tx) => tx.execute(compensationGovernanceQuery(org.id)));
    assert.equal(guarded.rows[0]?.blocked, true);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("even a draft compensation cycle closes the legacy direct-pay escape hatch", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Direct pay compensation cycle test",
    legalName: "Direct pay compensation cycle test",
    plan: "Core",
  }).returning();
  try {
    await db.insert(compensationCycles).values({
      organizationId: org.id,
      name: "New compensation review",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      effectiveDate: "2026-11-01",
      status: "draft",
      createdBy: "HCM governance test",
      budgetPool: "0",
    });
    assert.equal(await isGovernedCompensationWorkspace(org.id), true);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("invalid organization ids fail closed before any policy query", () => {
  assert.throws(() => compensationGovernanceQuery(0), /Valid organizationId/);
  assert.throws(() => compensationGovernanceQuery(-1), /Valid organizationId/);
  assert.throws(() => compensationGovernanceQuery(Number.NaN), /Valid organizationId/);
});

test("employee direct pay path requires MFA, company-wide finance rights, and a locked revision check", () => {
  const source = readFileSync("src/app/api/employees/route.ts", "utf8");
  const view = readFileSync("src/components/workspace/people.tsx", "utf8");
  assert.match(source, /if \(await isGovernedCompensationWorkspace\(organizationId\)\)/);
  assert.match(source, /Response\.json\(HCM_GOVERNED_COMPENSATION_REQUIRED, \{ status: 409 \}\)/);
  assert.ok(source.includes('action: "legacy-direct-pay-correction"'));
  assert.ok(source.includes("const mfaDenied = requireSensitiveActionMfa(user)"));
  assert.ok(source.includes("access?.companyWide"));
  assert.ok(source.includes('"bookkeeper"].includes(access.role)'));
  assert.ok(source.includes("pg_advisory_xact_lock(4221"));
  assert.ok(source.includes("compensationGovernanceQuery(organizationId)"));
  assert.ok(source.includes("latestPayRevisionId"));
  assert.ok(source.includes("HCM_DIRECT_PAY_STALE"));
  assert.ok(view.includes("Compensation approval workflow"));
});

test("legacy direct correction writes pay audit in the same transaction and never twice", () => {
  const source = readFileSync("src/app/api/employees/route.ts", "utf8");
  const transaction = source.slice(
    source.indexOf("const result = await db.transaction(async (tx) => {"),
    source.indexOf("const updated = result.updated;"),
  );
  assert.ok(transaction.includes("tx.insert(employeePayRevisions)"));
  assert.ok(transaction.includes("tx.insert(employeePayRetroAdjustments)"));
  assert.ok(transaction.includes("tx.insert(auditEvents)"));
  assert.ok(transaction.includes('route: "legacy-direct-pay-correction"'));
  assert.ok(source.includes("const audit = result.payAuditId"));
  assert.ok(source.includes("payWriteConflict"));
});
