import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { auditEvents, organizations } from "../src/db/schema";
import {
  checkIndependentPayrollReleaser, independentPayrollReleaseViolation,
} from "../src/lib/payroll-approval-release-separation";

const evidence = (deciderUserId: unknown) => ({ metadata: { deciderUserId } });

test("checker/releaser SoD uses authenticated identity, never display-name similarity", () => {
  assert.equal(independentPayrollReleaseViolation({
    approvalEvents: [evidence(11)], releasingUserId: 22,
  }), null);
  assert.equal(independentPayrollReleaseViolation({
    approvalEvents: [evidence(11)], releasingUserId: 11,
  })?.code, "PAYROLL_CHECKER_CANNOT_RELEASE");
  for (const malformed of [null, 0, "11", NaN, -1, 11.5]) {
    assert.equal(independentPayrollReleaseViolation({
      approvalEvents: [evidence(malformed)], releasingUserId: 22,
    })?.code, "PAYROLL_CHECKER_IDENTITY_UNVERIFIED");
  }
  assert.equal(independentPayrollReleaseViolation({
    approvalEvents: [], releasingUserId: 22,
  })?.code, "PAYROLL_CHECKER_IDENTITY_UNVERIFIED");
  assert.equal(independentPayrollReleaseViolation({
    approvalEvents: [evidence(11), evidence(22)], releasingUserId: 31,
  })?.code, "PAYROLL_CHECKER_IDENTITY_UNVERIFIED");
});

test("release gate checks exact tenant, payroll, task and delegated decider audit", async () => {
  const [left, right] = await db.insert(organizations).values([
    { name: "Release SoD Test A", legalName: "Release SoD Test A" },
    { name: "Release SoD Test B", legalName: "Release SoD Test B" },
  ]).returning();
  try {
    // A cross-tenant event with the same task and run cannot authorize A.
    await db.insert(auditEvents).values({
      organizationId: right.id, actor: "Checker B",
      action: "Approval approved", resource: "Task",
      metadata: { taskId: 910, payrollRunId: 920, deciderUserId: 12 },
    });
    const missing = await checkIndependentPayrollReleaser({
      organizationId: left.id, payrollRunId: 920, approvalTaskId: 910, releasingUserId: 34,
    });
    assert.equal(missing?.status, 409);

    // The actual delegated deciding actor ID is authoritative; names are not.
    await db.insert(auditEvents).values({
      organizationId: left.id, actor: "Delegated Approver",
      action: "Approval approved by delegate", resource: "Task",
      metadata: { taskId: 910, payrollRunId: 920, deciderUserId: 34 },
    });
    const self = await checkIndependentPayrollReleaser({
      organizationId: left.id, payrollRunId: 920, approvalTaskId: 910, releasingUserId: 34,
    });
    assert.equal(self?.status, 403);
    assert.equal((await self?.json())?.code, "PAYROLL_CHECKER_CANNOT_RELEASE");
    assert.equal(await checkIndependentPayrollReleaser({
      organizationId: left.id, payrollRunId: 920, approvalTaskId: 910, releasingUserId: 55,
    }), null);

    // An additional matching decision is suspicious even when the user differs.
    await db.insert(auditEvents).values({
      organizationId: left.id, actor: "Duplicate",
      action: "Approval approved", resource: "Task",
      metadata: { taskId: 910, payrollRunId: 920, deciderUserId: 55 },
    });
    const duplicate = await checkIndependentPayrollReleaser({
      organizationId: left.id, payrollRunId: 920, approvalTaskId: 910, releasingUserId: 77,
    });
    assert.equal(duplicate?.status, 409);
  } finally {
    await db.delete(organizations).where(
      // Foreign-key cascade removes synthetic audit events; one org at a time.
      eq(organizations.id, left.id),
    );
    await db.delete(organizations).where(
      eq(organizations.id, right.id),
    );
  }
});

test("release route checks checker separation after claim and before settlement", () => {
  const source = readFileSync("src/app/api/payroll-runs/[id]/release/route.ts", "utf8");
  const claim = source.indexOf('.set({ status: "Releasing" })');
  const guard = source.indexOf("const checkerGate = await checkIndependentPayrollReleaser");
  const settle = source.indexOf("await settlePayrollRun(runId,");
  assert.ok(claim >= 0 && guard > claim && settle > guard);
  assert.ok(source.includes('eq(payrollRuns.status, "Releasing")'));
  assert.ok(!source.includes("TREASURY_SEPARATION_ENABLED"));
});
