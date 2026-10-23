import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { seedMonthlyPayProfilesForRun } from "./helpers/pay-profiles";

/**
 * A real disposable PostgreSQL ONLY, never Neon or a developer's existing DB.
 * Follows the isolated GitHub Actions first-payroll acceptance configuration.
 * All worker identities and data are fictional. No payouts, providers or filing.
 */
const isolated = (() => {
  if (!(process.env.CI === "true" && process.env.GITHUB_ACTIONS === "true")) return false;
  const uri = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(uri.protocol, "postgresql:");
  assert.equal(uri.hostname, "127.0.0.1");
  assert.equal(uri.port, "5432");
  assert.equal(uri.pathname, "/app_db");
  assert.equal(uri.username, "postgres");
  return true;
})();

function cents(value: string | number) {
  const text = String(value);
  assert.match(text, /^-?\d+(?:\.\d{1,2})?$/);
  const sign = text.startsWith("-") ? -1 : 1;
  const [whole, fractional = ""] = text.replace("-", "").split(".");
  const amount = sign * (Number(whole) * 100 + Number(fractional.padEnd(2, "0")));
  assert.ok(Number.isSafeInteger(amount));
  return amount;
}
function lineTotal(value: unknown) {
  assert.ok(Array.isArray(value));
  return value.reduce((sum: number, raw: { amount: string }) => sum + cents(raw.amount), 0);
}
function report(entry: { employeeId: number; grossPay: string; deductions: string;
  netPay: string; lineItems: unknown; trace: unknown }) {
  return {
    employeeId: entry.employeeId,
    grossPay: entry.grossPay,
    deductions: entry.deductions,
    netPay: entry.netPay,
    lineItems: entry.lineItems,
    trace: entry.trace,
  };
}

test("FICTIONAL PG: actual two-tenant, 51-worker cutoff -> review/rerun -> payslip -> remittance snapshot -> release -> GL", {
  skip: !isolated,
}, async () => {
  const previousExitFlag = process.env.APPROVED_EXIT_PAYROLL_ENABLED;
  process.env.APPROVED_EXIT_PAYROLL_ENABLED = "true";
  const { and, eq, inArray } = await import("drizzle-orm");
  const { db } = await import("../src/db");
  const { organizations, legalEntities, employees, timePunches,
    payrollRuns, payrollEntries, payslips, auditEvents, separationRecords, users } = await import("../src/db/schema");
  const { enqueuePayrollRun, drainPayrollQueue } = await import("../src/lib/payroll-engine");
  const { settlePayrollRun } = await import("../src/lib/payroll-settlement");
  const { buildReleasedPayrollJournal } = await import("../src/lib/payroll-journal-export");
  const { buildStatutoryRemittanceSnapshot } = await import("../src/lib/statutory-remittance");
  const suffix = randomBytes(6).toString("hex");
  const orgs = await db.insert(organizations).values([
    { name: "Fictional E2E Alpha " + suffix, legalName: "Fictional Alpha Test Corp", plan: "Core" },
    { name: "Fictional E2E Beta " + suffix, legalName: "Fictional Beta Test Corp", plan: "Core" },
  ]).returning();
  try {
    const [alpha, beta] = orgs;
    const [entityA, entityB] = await db.insert(legalEntities).values([
      { organizationId: alpha.id, code: "TEST-A", legalName: "Fictional Alpha Test Corp",
        displayName: "Alpha", primaryEntity: true },
      { organizationId: beta.id, code: "TEST-B", legalName: "Fictional Beta Test Corp",
        displayName: "Beta", primaryEntity: true },
    ]).returning();
    const alphaWorkers = await db.insert(employees).values(
      Array.from({ length: 51 }, (_, i) => ({
        organizationId: alpha.id, legalEntityId: entityA.id,
        employeeNo: "FA-" + suffix + "-" + String(i + 1).padStart(3, "0"),
        firstName: "Fictional", lastName: "Alpha" + i, title: "No-money QA",
        avatarInitials: "FA", basicRate: "22000.01", startDate: "2025-01-01",
        mobile: "09999999999",
      })),
    ).returning();
    const betaWorkers = await db.insert(employees).values(
      Array.from({ length: 2 }, (_, i) => ({
        organizationId: beta.id, legalEntityId: entityB.id,
        employeeNo: "FB-" + suffix + "-" + String(i + 1).padStart(3, "0"),
        firstName: "Fictional", lastName: "Beta" + i, title: "No-money QA",
        avatarInitials: "FB", basicRate: "22000.00", startDate: "2025-01-01",
        mobile: "09999999999",
      })),
    ).returning();
    const [runA, runB] = await db.insert(payrollRuns).values([
      { organizationId: alpha.id, legalEntityId: entityA.id,
        periodLabel: "Fictional October 1-15", periodStart: "2026-10-01",
        periodEnd: "2026-10-15", payDate: "2026-10-15",
        scopeLabel: "All locations", status: "Draft" },
      { organizationId: beta.id, legalEntityId: entityB.id,
        periodLabel: "Fictional October 1-15", periodStart: "2026-10-01",
        periodEnd: "2026-10-15", payDate: "2026-10-15",
        scopeLabel: "All locations", status: "Draft" },
    ]).returning();

    const entries = (runId: number) =>
      db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, runId));
    const slips = (orgId: number) =>
      db.select().from(payslips).where(eq(payslips.organizationId, orgId));
    const runHeader = async (id: number) => {
      const [row] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, id));
      assert.ok(row);
      return row;
    };
    const reconcile = async (id: number, expectedCount: number) => {
      const header = await runHeader(id);
      const rows = await entries(id);
      assert.equal(rows.length, expectedCount);
      assert.equal(header.employeeCount, expectedCount);
      assert.equal(rows.reduce((sum, e) => sum + cents(e.grossPay), 0), cents(header.grossPay));
      assert.equal(rows.reduce((sum, e) => sum + cents(e.netPay), 0), cents(header.netPay));
      for (const row of rows) {
        assert.equal(cents(row.grossPay) - cents(row.deductions), cents(row.netPay));
        assert.equal(lineTotal(row.lineItems), cents(row.netPay),
          "Persisted signed payslip lines should equal its persisted net");
        assert.ok(cents(row.netPay) >= 0);
      }
      return rows;
    };

    await seedMonthlyPayProfilesForRun(runA.id);

    await enqueuePayrollRun(runA.id, 25);
    await drainPayrollQueue(10, runA.id);
    const aFirst = await reconcile(runA.id, 51);
    assert.equal(cents((await runHeader(runA.id)).grossPay), 56100051,
      "51 individually rounded half-cent salaries = 561000.51, not 561000.26");
    assert.equal((await slips(alpha.id)).length, 51);
    assert.ok((await slips(alpha.id)).every((s) => s.content.includes("Gross: PHP ")));
    const preservedAlpha = aFirst.map(report).sort((a, b) => a.employeeId - b.employeeId);
    const firstSlips = (await slips(alpha.id)).map((s) => s.content).sort();

    // Identical rerun of a Needs review run replaces detail/payslips, not appends.
    await seedMonthlyPayProfilesForRun(runA.id);
    await enqueuePayrollRun(runA.id, 25);
    await drainPayrollQueue(10, runA.id);
    const aReplay = await reconcile(runA.id, 51);
    assert.deepEqual(aReplay.map(report).sort((a, b) => a.employeeId - b.employeeId), preservedAlpha);
    assert.deepEqual((await slips(alpha.id)).map((s) => s.content).sort(), firstSlips);
    assert.equal((await slips(alpha.id)).length, 51);
    assert.equal((await drainPayrollQueue(2, runA.id)).length, 0,
      "No pending job may append a third copy");

    // Same date and payroll calendar, separate employer/run/statutory identities.
    await seedMonthlyPayProfilesForRun(runB.id);
    await enqueuePayrollRun(runB.id, 25);
    await drainPayrollQueue(10, runB.id);
    const bRows = await reconcile(runB.id, 2);
    assert.equal(cents((await runHeader(runB.id)).grossPay), 2200000);
    assert.equal((await slips(beta.id)).length, 2);
    assert.deepEqual((await entries(runA.id)).map(report).sort((a, b) => a.employeeId - b.employeeId),
      preservedAlpha, "Creating another employer does not change Alpha");

    // Actual remittance snapshot builder is used with persisted, employer-scoped entries.
    // These are internal expected shares, NOT files/filings or agency acceptance.
    const snapshots = ["SSS", "PhilHealth", "Pag-IBIG"].map((agency) =>
      buildStatutoryRemittanceSnapshot({
        agency: agency as "SSS" | "PhilHealth" | "Pag-IBIG",
        applicableMonth: "2026-10",
        entries: bRows.map((e) => ({ employeeId: e.employeeId, lineItems: e.lineItems, trace: e.trace })),
        employees: betaWorkers.map((w) => ({ id: w.id, employeeNo: w.employeeNo })),
      }));
    snapshots.forEach((snapshot) => {
      assert.equal(snapshot.employeeCount, 2);
      const ee = snapshot.members.reduce((sum, m) => sum + cents(m.employeeShare), 0);
      const er = snapshot.members.reduce((sum, m) => sum + cents(m.employerShare), 0);
      assert.equal(cents(snapshot.expectedEmployeeShare), ee);
      assert.equal(cents(snapshot.expectedEmployerShare), er);
      assert.equal(cents(snapshot.expectedTotal), ee + er);
      assert.equal(snapshot.snapshotHash.length, 64);
    });
    assert.equal(cents(snapshots[0].expectedEmployeeShare), 110000); // SSS, 2 x PHP550 EE
    assert.equal(cents(snapshots[0].expectedEmployerShare), 223000); // 2 x (PHP1100 ER + PHP15 EC)
    assert.equal(cents(snapshots[1].expectedEmployeeShare), 55000); // 2 x PHP275
    assert.equal(cents(snapshots[1].expectedEmployerShare), 55000);
    assert.equal(cents(snapshots[2].expectedEmployeeShare), 20000); // 2 x PHP100
    assert.equal(cents(snapshots[2].expectedEmployerShare), 20000);

    // This *test fixture* transitions reviewed -> releasing without claiming
    // approval UI/MFA coverage; settlePayrollRun is the actual atomic release path.
    await db.update(payrollRuns).set({ status: "Releasing" })
      .where(and(eq(payrollRuns.id, runB.id), eq(payrollRuns.status, "Needs review")));
    const released = await settlePayrollRun(runB.id, {
      actor: "Fictional E2E checker", resource: "Fictional October 1-15",
      metadata: { source: "synthetic isolated CI, no money movement" },
    });
    assert.equal(released.run.status, "Released");
    assert.equal((await runHeader(runB.id)).status, "Released");
    await assert.rejects(() => settlePayrollRun(runB.id), /no longer in the releasing state/);
    await assert.rejects(() => enqueuePayrollRun(runB.id, 25), /PAYROLL_RECALCULATION_NOT_ALLOWED/);
    assert.deepEqual((await entries(runB.id)).map(report).sort((a, b) => a.employeeId - b.employeeId),
      bRows.map(report).sort((a, b) => a.employeeId - b.employeeId),
      "Released entry and payslip money cannot be silently rewritten");
    assert.equal((await slips(beta.id)).length, 2);
    const ledger = buildReleasedPayrollJournal([await runHeader(runB.id)]);
    const debits = ledger.reduce((n, line) => n + line.debitCentavos, 0);
    const credits = ledger.reduce((n, line) => n + line.creditCentavos, 0);
    assert.equal(debits, credits);
    assert.equal(debits, 2200000);
    assert.equal(ledger.find((line) => line.accountCode === "2100")?.creditCentavos, 185000);
    assert.equal(ledger.find((line) => line.accountCode === "2200")?.creditCentavos, 2015000);
    const releaseAudit = await db.select().from(auditEvents).where(eq(auditEvents.organizationId, beta.id));
    assert.ok(releaseAudit.some((item) => item.action === "Payroll released"));

    // Correction of reviewed (not released) Alpha: approved source attendance
    // changes gross by independent 2h OT at hourly 125 x 1.25 = PHP312.50.
    await db.insert(timePunches).values({
      organizationId: alpha.id, employeeId: alphaWorkers[0].id,
      workDate: "2026-10-09",
      timeIn: new Date("2026-10-09T09:00:00+08:00"),
      timeOut: new Date("2026-10-09T20:00:00+08:00"),
      shiftStart: "09:00", shiftEnd: "18:00", status: "Complete",
    });
    await seedMonthlyPayProfilesForRun(runA.id);
    await enqueuePayrollRun(runA.id, 25);
    await drainPayrollQueue(10, runA.id);
    const corrected = await reconcile(runA.id, 51);
    assert.equal(cents((await runHeader(runA.id)).grossPay), 56131301,
      "Reviewed 561000.51 + 312.50 must be 561313.01, not double counted");
    assert.notDeepEqual(corrected.map(report).sort((a, b) => a.employeeId - b.employeeId),
      preservedAlpha, "Source change must change the re-reviewed calculation");
    assert.equal((await slips(alpha.id)).length, 51);
    assert.deepEqual((await entries(runB.id)).map(report), bRows.map(report),
      "Released Beta is unaffected by Alpha correction");
    await assert.rejects(() => enqueuePayrollRun(runB.id), /PAYROLL_RECALCULATION_NOT_ALLOWED/);

    // Approved (not draft) fictional separation is a distinct source correction.
    // Worker Alpha #2 earns 9/15 of PHP11000.005 = PHP6600.00, not PHP11000.01.
    // No legal separation entitlement is inferred here; only employment end.
    const [exitMaker, exitChecker] = await db.insert(users).values([
      { name: "Fictional Exit Maker", email: "exit-maker-" + suffix + "@example.invalid", passwordHash: "fixture-no-login", role: "owner" },
      { name: "Fictional Exit Checker", email: "exit-checker-" + suffix + "@example.invalid", passwordHash: "fixture-no-login", role: "owner" },
    ]).returning();
    await db.insert(separationRecords).values({
      organizationId: alpha.id, employeeId: alphaWorkers[1].id,
      separationType: "resignation", noticeDate: "2026-09-20",
      lastDay: "2026-10-09", status: "approved",
      preparedByUserId: exitMaker.id, approvedByUserId: exitChecker.id,
    });
    await db.update(employees).set({ status: "Separating" }).where(eq(employees.id, alphaWorkers[1].id));
    await seedMonthlyPayProfilesForRun(runA.id);
    await enqueuePayrollRun(runA.id, 25);
    await drainPayrollQueue(10, runA.id);
    const afterExit = await reconcile(runA.id, 51);
    const exited = afterExit.find((row) => row.employeeId === alphaWorkers[1].id);
    assert.ok(exited);
    assert.equal(cents(exited.grossPay), 660000);
    assert.equal(cents((await runHeader(runA.id)).grossPay), 55691300,
      "Previous 561313.01 - (11000.01 - 6600.00) = 556913.00");
    assert.ok((exited.trace as { inputs?: string[] }).inputs?.includes("employmentEnd=2026-10-09"));
    assert.equal((await slips(alpha.id)).length, 51);
    assert.deepEqual((await entries(runB.id)).map(report).sort((a, b) => a.employeeId - b.employeeId),
      bRows.map(report).sort((a, b) => a.employeeId - b.employeeId));
  } finally {
    if (previousExitFlag === undefined) delete process.env.APPROVED_EXIT_PAYROLL_ENABLED;
    else process.env.APPROVED_EXIT_PAYROLL_ENABLED = previousExitFlag;
    // Explicit dependent teardown avoids RESTRICT FK ordering between
    // legal employers, released runs and workers. Remaining child rows cascade.
    const orgIds = orgs.map((org) => org.id);
    await db.delete(payrollRuns).where(inArray(payrollRuns.organizationId, orgIds));
    await db.delete(employees).where(inArray(employees.organizationId, orgIds));
    await db.delete(legalEntities).where(inArray(legalEntities.organizationId, orgIds));
    await db.delete(organizations).where(inArray(organizations.id, orgIds));
    await db.delete(users).where(inArray(users.email, ["exit-maker-" + suffix + "@example.invalid", "exit-checker-" + suffix + "@example.invalid"]));
  }
});
