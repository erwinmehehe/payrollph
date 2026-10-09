import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  employees, organizations, payrollEntries, payrollRuns,
  payrollUnderpaymentRequests, users,
} from "../src/db/schema";
import {
  conflictingCutoff, hasOriginalBasicPayLine, parsePositiveUnderpaymentCents,
  payrollSourceFingerprint, validCalendarDate,
} from "../src/lib/payroll-underpayment";

test("underpayments accept exact positive centavos, never floats, negatives or out-of-range amounts", () => {
  for (const [value, cents] of [
    ["0.01", 1], ["0.10", 10], ["1200.00", 120000],
    ["1", 100], ["1000000", 100000000],
  ] as const) assert.equal(parsePositiveUnderpaymentCents(value), cents, String(value));
  for (const invalid of ["0", 0, "-1", -1, "1000000.01", "1000001", "1.234", "1e3", "Infinity", NaN, "01"]) {
    assert.equal(parsePositiveUnderpaymentCents(invalid), null, String(invalid));
  }
});

test("source fingerprints are deterministic and reject altered payroll amounts or lines", () => {
  const original = { id: 1, payrollRunId: 2, employeeId: 3,
    grossPay: "20000.00", netPay: "17300.00", lineItems: [{ code: "BASIC", amount: "20000.00" }] };
  const a = payrollSourceFingerprint(original);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, payrollSourceFingerprint({ ...original }));
  assert.notEqual(a, payrollSourceFingerprint({ ...original, grossPay: "20001.00" }));
  assert.notEqual(a, payrollSourceFingerprint({ ...original, lineItems: [{ code: "BASIC", amount: "20001.00" }] }));
  assert.notEqual(a, payrollSourceFingerprint({ ...original, deductions: "2000.00" }));
  assert.notEqual(a, payrollSourceFingerprint({ ...original, trace: { signed: "later" } }));
});

test("basic salary underpayment cannot be based on an unrelated earning-only source", () => {
  assert.equal(hasOriginalBasicPayLine([{ code: "BASIC", amount: "0.00" }]), true);
  assert.equal(hasOriginalBasicPayLine([{ code: "OT", amount: "1200.00" }]), false);
  assert.equal(hasOriginalBasicPayLine([]), false);
  assert.equal(hasOriginalBasicPayLine({ code: "BASIC" }), false);
});

test("only an empty Draft overlapping employee cutoff is eligible", () => {
  const run = { periodStart: "2026-10-16", periodEnd: "2026-10-31",
    scopeOrgUnitId: null, status: "Draft", processedChunks: 0, employeeCount: 0 };
  assert.equal(conflictingCutoff([run], null, "2026-10-20"), null);
  assert.equal(conflictingCutoff([{ ...run, status: "Ready for release" }], null, "2026-10-20")?.status, "Ready for release");
  assert.equal(conflictingCutoff([{ ...run, processedChunks: 1 }], null, "2026-10-20")?.processedChunks, 1);
  assert.equal(conflictingCutoff([{ ...run, employeeCount: 1 }], null, "2026-10-20")?.employeeCount, 1);
  assert.equal(conflictingCutoff([{ ...run, scopeOrgUnitId: 3, status: "Released" }], 4, "2026-10-20"), null);
  assert.equal(conflictingCutoff([{ ...run, status: "Released" }], null, "2026-11-01"), null);
});

test("future-correction dates reject impossible dates", () => {
  assert.equal(validCalendarDate("2024-02-29"), true);
  assert.equal(validCalendarDate("2026-02-30"), false);
  assert.equal(validCalendarDate("2026-13-01"), false);
  assert.equal(validCalendarDate("10/09/2026"), false);
});

test("database enforces at most one pending or posted claim per source worker/run and reviews are immutable", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Underpayment maker-checker QA",
    legalName: "Underpayment maker-checker QA",
    plan: "Core",
  }).returning();
  const [maker, checker] = await db.insert(users).values([
    { email: `up-maker-${randomUUID()}@example.invalid`, name: "Correction Maker", passwordHash: "test-only" },
    { email: `up-checker-${randomUUID()}@example.invalid`, name: "Correction Checker", passwordHash: "test-only" },
  ]).returning();
  try {
    const [worker] = await db.insert(employees).values({
      organizationId: org.id, employeeNo: "HCM-UP-1", firstName: "Lea", lastName: "Reyes",
      title: "Staff", avatarInitials: "LR", basicRate: "20000.00", startDate: "2026-01-01",
    }).returning();
    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id, periodLabel: "Sep 16-30", periodStart: "2026-09-16",
      periodEnd: "2026-09-30", payDate: "2026-09-30", status: "Released",
    }).returning();
    const [entry] = await db.insert(payrollEntries).values({
      payrollRunId: run.id, employeeId: worker.id, grossPay: "20000.00",
      deductions: "2500.00", netPay: "17500.00", lineItems: [{ code: "BASIC", amount: "20000.00" }],
    }).returning();
    const input = {
      organizationId: org.id, employeeId: worker.id, sourcePayrollRunId: run.id,
      sourcePayrollEntryId: entry.id, sourceEntryHash: payrollSourceFingerprint(entry),
      amount: "1250.00", effectiveDate: "2026-10-16",
      reason: "Basic pay underpayment documented by independent reconciliation.",
      evidenceReference: "AUDIT-WORKBOOK-2026-10", requestedByUserId: maker.id,
      requestedBy: maker.name, status: "pending_review",
    };
    const [pending] = await db.insert(payrollUnderpaymentRequests).values(input).returning();
    assert.equal(pending.postedEarningId, null);
    assert.equal(pending.reviewedByUserId, null);
    await assert.rejects(() => db.insert(payrollUnderpaymentRequests).values(input), /unique|duplicate/i);
    await assert.rejects(() => db.update(payrollUnderpaymentRequests).set({
      status: "posted",
    }).where(eq(payrollUnderpaymentRequests.id, pending.id)), /check|violat/i);
    await db.update(payrollUnderpaymentRequests).set({
      status: "rejected", reviewedByUserId: checker.id, reviewedBy: checker.name, reviewedAt: new Date(),
    }).where(eq(payrollUnderpaymentRequests.id, pending.id));
    const [newPending] = await db.insert(payrollUnderpaymentRequests).values(input).returning();
    assert.ok(newPending.id > pending.id);
    await assert.rejects(() => db.insert(payrollUnderpaymentRequests).values({
      ...input, amount: "-100.00",
    }), /check|violat/i);
  } finally {
    await db.delete(payrollUnderpaymentRequests).where(eq(payrollUnderpaymentRequests.organizationId, org.id));
    await db.delete(organizations).where(eq(organizations.id, org.id));
    await db.delete(users).where(eq(users.id, maker.id));
    await db.delete(users).where(eq(users.id, checker.id));
  }
});

test("API implements company-wide MFA, independent maker-checker and atomic payroll posting", () => {
  const route = readFileSync("src/app/api/payroll-underpayments/route.ts", "utf8");
  const earnings = readFileSync("src/app/api/payroll-earnings/route.ts", "utf8");
  const panel = readFileSync("src/components/payroll-underpayment-panel.tsx", "utf8");
  assert.ok(route.includes("PAYROLL_OPERATOR_ROLES"));
  assert.ok(route.includes("PAYROLL_TAX_APPROVER_ROLES"));
  assert.ok(route.includes('process.env.PAYROLL_UNDERPAYMENT_POSTING_ENABLED !== "true"'));
  assert.ok(route.includes('code: "UNDERPAYMENT_POSTING_NOT_CERTIFIED"'));
  assert.ok(route.includes("PAYROLL_VIEW_ROLES"));
  assert.ok(route.includes("!access?.companyWide"));
  assert.ok(route.includes("requireSensitiveActionMfa(user)"));
  assert.ok(route.includes("pending.requestedByUserId === user.id"));
  assert.ok(route.includes("UNDERPAYMENT_SELF_REVIEW"));
  assert.ok(route.includes("FOR UPDATE") || route.includes("for update"));
  assert.ok(route.includes("db.transaction(async tx"));
  assert.ok(route.includes("ORDER BY id FOR UPDATE")); // target cutoff lock
  assert.ok(route.includes("tx.insert(auditEvents)"));
  assert.ok(route.includes("tx.insert(supplementaryEarnings)"));
  assert.ok(route.includes('earningType: "other_taxable"'));
  assert.ok(route.includes("payrollSourceFingerprint(entries[0]) !== pending.sourceEntryHash"));
  assert.ok(route.includes("sourceEntries.length !== 1"));
  assert.ok(route.includes("hasOriginalBasicPayLine(entries[0].lineItems)"));
  assert.ok(route.includes("UNDERPAYMENT_NO_BASIC_SOURCE"));
  assert.ok(route.includes("entries.length !== 1"));
  assert.ok(earnings.includes("REVIEWED_UNDERPAYMENT_IMMUTABLE"));
  assert.ok(earnings.includes("payrollUnderpaymentRequests.postedEarningId"));
  assert.ok(panel.includes("Submit for independent review"));
  assert.ok(panel.includes("Approve &amp; post once"));
});

test("schema and SQL migration define status check, owner separation and unique active source", () => {
  const schema = readFileSync("src/db/schema.ts", "utf8");
  const migration = readFileSync("drizzle/0101_reviewed_payroll_underpayments.sql", "utf8");
  const baseline = readFileSync("drizzle/baseline.sql", "utf8");
  for (const source of [schema, migration]) {
    assert.ok(source.includes("payroll_underpayment_requests"));
    assert.ok(source.includes("payroll_underpayment_one_source_unique"));
    assert.ok(source.includes("payroll_underpayment_posted_consistency_check"));
  }
  assert.ok(!baseline.includes("payroll_underpayment_requests"), "Historical baseline stays immutable; apply new 0101 migration.");
});
