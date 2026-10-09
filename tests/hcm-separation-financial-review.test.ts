import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  employees, organizations, separationRecords, users,
} from "../src/db/schema";
import {
  canAttestSeparationClearance,
  independentFinalPayApproval,
  independentFinalPayRelease,
  parseSeparationClearance,
  validSeparationDate,
} from "../src/lib/separation-review-controls";

test("exactly one strictly boolean departmental clearance requires a traceable reference", () => {
  assert.deepEqual(parseSeparationClearance({
    itCleared: true, evidenceReference: "IT-REVIEW-2026-10",
  }), { field: "itCleared", value: true, evidenceReference: "IT-REVIEW-2026-10" });
  assert.deepEqual(parseSeparationClearance({
    financeCleared: false, evidenceReference: "REVERSAL-2026-10",
  }), { field: "financeCleared", value: false, evidenceReference: "REVERSAL-2026-10" });
  for (const payload of [
    { itCleared: true, financeCleared: true, evidenceReference: "MULTI-CASE-100" },
    { itCleared: "false", evidenceReference: "TICKET-2026-10" },
    { itCleared: 1, evidenceReference: "TICKET-2026-10" },
    { itCleared: true, evidenceReference: "short" },
    { evidenceReference: "TICKET-2026-10" },
  ]) {
    assert.equal(parseSeparationClearance(payload), null, JSON.stringify(payload));
  }
});

test("department roles distinguish independent payroll, HR and IT/admin attestation", () => {
  assert.equal(canAttestSeparationClearance("payroll", "financeCleared"), true);
  assert.equal(canAttestSeparationClearance("payroll", "hrCleared"), false);
  assert.equal(canAttestSeparationClearance("hr", "hrCleared"), true);
  assert.equal(canAttestSeparationClearance("hr", "financeCleared"), false);
  assert.equal(canAttestSeparationClearance("manager", "itCleared"), false);
  assert.equal(canAttestSeparationClearance("owner", "itCleared"), true);
});

test("separation maker cannot approve or release, and legacy unidentified approvals fail closed", () => {
  assert.equal(independentFinalPayApproval(null, 1), "FINAL_PAY_PREPARER_UNKNOWN");
  assert.equal(independentFinalPayApproval(1, 1), "FINAL_PAY_SELF_APPROVAL");
  assert.equal(independentFinalPayApproval(1, 2), null);
  assert.equal(independentFinalPayRelease(null, 2, 3), "FINAL_PAY_REVIEW_EVIDENCE_MISSING");
  assert.equal(independentFinalPayRelease(1, null, 3), "FINAL_PAY_REVIEW_EVIDENCE_MISSING");
  assert.equal(independentFinalPayRelease(1, 1, 3), "FINAL_PAY_SELF_APPROVAL");
  assert.equal(independentFinalPayRelease(1, 2, 1), "FINAL_PAY_MAKER_CANNOT_RELEASE");
  assert.equal(independentFinalPayRelease(1, 2, 2), null);
});

test("Gregorian dates reject nonexistent separation anniversaries or invalid formats", () => {
  assert.equal(validSeparationDate("2026-02-30"), false);
  assert.equal(validSeparationDate("2024-02-29"), true);
  assert.equal(validSeparationDate("2026-10-09"), true);
  assert.equal(validSeparationDate("2026-13-01"), false);
  assert.equal(validSeparationDate("10/09/2026"), false);
});

test("PostgreSQL persists distinct financial actors and rejects identical preparer/reviewer", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Separation reviewer QA", legalName: "Separation reviewer QA", plan: "Core",
  }).returning();
  const suffix = randomUUID();
  let makerId: number | null = null;
  let checkerId: number | null = null;
  try {
    const [maker, checker] = await db.insert(users).values([
      { email: `separation-maker-${suffix}@example.invalid`, name: "Final Pay Maker", passwordHash: "test-only" },
      { email: `separation-checker-${suffix}@example.invalid`, name: "Final Pay Checker", passwordHash: "test-only" },
    ]).returning();
    makerId = maker.id; checkerId = checker.id;
    const [worker] = await db.insert(employees).values({
      organizationId: org.id, employeeNo: "SEP-MC-01", firstName: "Mae", lastName: "Luna",
      title: "Staff", avatarInitials: "ML", basicRate: "30000.00",
      startDate: "2025-01-01",
    }).returning();
    const [sep] = await db.insert(separationRecords).values({
      organizationId: org.id, employeeId: worker.id, separationType: "resignation",
      noticeDate: "2026-09-01", lastDay: "2026-10-01", preparedByUserId: maker.id,
      status: "draft",
    }).returning();
    assert.equal(sep.preparedByUserId, maker.id);
    assert.equal(sep.approvedByUserId, null);
    await assert.rejects(() => db.update(separationRecords)
      .set({ status: "approved", approvedByUserId: maker.id })
      .where(eq(separationRecords.id, sep.id)), (error: unknown) => {
        // Drizzle wraps the PostgreSQL check-constraint error in a generic
        // Failed query exception. Inspect the actual driver cause, not a
        // human-readable wrapper message that can change between versions.
        const wrapped = error as { cause?: { code?: string; constraint?: string } };
        return wrapped.cause?.code === "23514"
          && wrapped.cause.constraint === "separation_review_identity_separation_check";
      });
    const [approved] = await db.update(separationRecords)
      .set({ status: "approved", approvedByUserId: checker.id })
      .where(eq(separationRecords.id, sep.id))
      .returning();
    assert.equal(approved.approvedByUserId, checker.id);
    assert.equal(independentFinalPayRelease(approved.preparedByUserId, approved.approvedByUserId, checker.id), null);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
    if (makerId) await db.delete(users).where(eq(users.id, makerId));
    if (checkerId) await db.delete(users).where(eq(users.id, checkerId));
  }
});

test("source enforces MFA, company-wide checker rights and transactional audit at every money-bearing step", () => {
  const route = readFileSync("src/app/api/separation/route.ts", "utf8");
  const ui = readFileSync("src/components/separation-panel.tsx", "utf8");
  const migration = readFileSync("drizzle/0102_separation_financial_reviewer_identity.sql", "utf8");
  const schema = readFileSync("src/db/schema.ts", "utf8");
  assert.ok(route.includes("validSeparationDate(noticeDate)"));
  assert.ok(route.includes("preparedByUserId: user.id"));
  assert.ok(route.includes("approvedByUserId: user.id"));
  assert.ok(route.includes("releasedByUserId: user.id"));
  assert.ok(route.includes("independentFinalPayApproval(sep.preparedByUserId, user.id)"));
  assert.ok(route.includes("independentFinalPayRelease("));
  assert.ok(route.includes("if (!access.companyWide)"));
  assert.ok(route.includes("enforceSensitiveActionRateLimit(request"));
  assert.ok(route.includes('action: "Separation departmental clearance decision"'));
  assert.ok(route.includes('action: "Final pay independently approved"'));
  assert.ok(route.includes('action: "Final pay released"'));
  assert.ok(route.includes("tx.insert(auditEvents)"));
  assert.ok(route.includes("SEPARATION_CLEARANCE_INPUT_INVALID"));
  assert.ok(route.includes("FINAL_PAY_APPROVAL_STALE"));
  assert.ok(route.includes('liveEmployee.status !== "Separating"'));
  assert.ok(route.includes("String(fresh.lastDay) > todayPh()"));
  assert.ok(ui.includes("Separation clearance evidence reference"));
  assert.ok(ui.includes("COE delivery evidence reference"));
  assert.ok(ui.includes("Preparer user #"));
  assert.ok(migration.includes("separation_review_identity_separation_check"));
  assert.ok(schema.includes("separation_review_identity_separation_check"));
});
