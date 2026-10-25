import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

// Drizzle wraps PostgreSQL errors in a query error. Validate the underlying
// SQLSTATE/constraint/trigger, not its outer "Failed query" wrapper message.
async function expectPostgresRejection(action: () => PromiseLike<unknown>, pattern: RegExp) {
  await assert.rejects(async () => action(), (error: unknown) => {
    const parts: string[] = [];
    const seen = new Set<unknown>();
    let current: unknown = error;
    while (current && typeof current === "object" && !seen.has(current)) {
      seen.add(current);
      const detail = current as { message?: string; constraint?: string; code?: string; cause?: unknown };
      parts.push([detail.message, detail.constraint, detail.code].filter(Boolean).join(" "));
      current = detail.cause;
    }
    assert.match(parts.join("\n"), pattern, "Expected a genuine PostgreSQL constraint or trigger error");
    return true;
  });
}

// This test deliberately replaces the blank db:push version of the history
// table with the exact forward SQL. NEVER run it on an existing DB or Neon.
const enabled = process.env.PAYROLL_F04_ISOLATED_POSTGRES === "disposable-ci-only";
if (enabled) {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.DATABASE_URL,
    "postgresql://postgres:postgres@127.0.0.1:5432/app_db");
  assert.notEqual(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "true");
  assert.notEqual(process.env.XENDIT_PAYOUTS_ENABLED, "true");
  for (const key of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY"]) {
    assert.equal(Boolean(process.env[key]), false);
  }
}

test("F-04 PG16: exact forward migration, immutability, revision chain, replay and tenant deletion", {
  skip: !enabled,
  timeout: 120000,
}, async () => {
  const { db, pool } = await import("../src/db");
  const { eq } = await import("drizzle-orm");
  const { organizations, legalEntities, employees, payrollRuns, payrollJobs,
    payrollCalculationHistory } = await import("../src/db/schema");
  const { createPayrollCalculationEvidence, verifyPayrollCalculationEvidence } = await import(
    "../src/lib/payroll-calculation-history"
  );
  const migration = readFileSync("drizzle/0137_immutable_payroll_calculation_history.sql", "utf8");

  // Strictly on the disposable CI DB: Drizzle db:push creates the declaration
  // but does not install SQL triggers, so rehearse the REAL migration instead.
  const [preflight] = (await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM public.payroll_calculation_history",
  )).rows;
  assert.equal(preflight.count, "0", "F-04 rehearsal refuses a non-empty history table");
  const setup = await pool.connect();
  try {
    await setup.query("BEGIN");
    await setup.query("DROP TABLE public.payroll_calculation_history");
    // Source-baseline supplement already installs the isolated functions and
    // triggers. Remove only those objects in the disposable DB so the *exact*
    // forward 0137 SQL can be re-executed and validated from scratch.
    await setup.query("DROP FUNCTION public.payroll_calculation_history_validate_insert()");
    await setup.query("DROP FUNCTION public.payroll_calculation_history_reject_mutation()");
    await setup.query(migration);
    await setup.query("COMMIT");
  } catch (error) {
    await setup.query("ROLLBACK");
    throw error;
  } finally {
    setup.release();
  }

  const nonce = randomBytes(6).toString("hex");
  const createdOrgs: number[] = [];
  try {
    const [alpha, beta] = await db.insert(organizations).values([
      { name: "F04 fictional Alpha " + nonce, legalName: "F04 fictional Alpha Inc." },
      { name: "F04 fictional Beta " + nonce, legalName: "F04 fictional Beta Inc." },
    ]).returning();
    createdOrgs.push(alpha.id, beta.id);
    const [entityA, entityB] = await db.insert(legalEntities).values([
      { organizationId: alpha.id, code: "F04-A", legalName: "F04 Alpha", displayName: "F04 Alpha" },
      { organizationId: beta.id, code: "F04-B", legalName: "F04 Beta", displayName: "F04 Beta" },
    ]).returning();
    const [workerA, workerB] = await db.insert(employees).values([
      { organizationId: alpha.id, legalEntityId: entityA.id, employeeNo: "F04-A-" + nonce,
        firstName: "Synthetic", lastName: "Alpha", title: "QA", avatarInitials: "SA",
        basicRate: "20000.00", startDate: "2025-01-01" },
      { organizationId: beta.id, legalEntityId: entityB.id, employeeNo: "F04-B-" + nonce,
        firstName: "Synthetic", lastName: "Beta", title: "QA", avatarInitials: "SB",
        basicRate: "20000.00", startDate: "2025-01-01" },
    ]).returning();
    const [runA, runB] = await db.insert(payrollRuns).values([
      { organizationId: alpha.id, legalEntityId: entityA.id, periodLabel: "F04 fictional run",
        periodStart: "2026-10-01", periodEnd: "2026-10-15", payDate: "2026-10-15",
        status: "Queued" },
      { organizationId: beta.id, legalEntityId: entityB.id, periodLabel: "F04 fictional run",
        periodStart: "2026-10-01", periodEnd: "2026-10-15", payDate: "2026-10-15",
        status: "Queued" },
    ]).returning();
    const [jobA1, jobB] = await db.insert(payrollJobs).values([
      { organizationId: alpha.id, payrollRunId: runA.id, status: "processing" },
      { organizationId: beta.id, payrollRunId: runB.id, status: "processing" },
    ]).returning();
    const first = createPayrollCalculationEvidence({
      organizationId: alpha.id, legalEntityId: entityA.id, payrollRunId: runA.id,
      payrollJobId: jobA1.id, employeeId: workerA.id,
      revision: 1, previousSnapshotHash: null,
      periodLabel: "F04 fictional run", periodStart: "2026-10-01",
      periodEnd: "2026-10-15", payDate: "2026-10-15",
      ruleVersion: runA.ruleVersion, grossPay: "10000.00", deductions: "1000.00",
      netPay: "9000.00", status: "Ready",
      lineItems: [{ code: "BASIC", amount: "10000.00" }],
      trace: { inputs: ["fictional"], payment: { employeeName: "Sensitive", bankAccount: "fake-key" } },
    });
    const [inserted] = await db.insert(payrollCalculationHistory).values(first).returning();
    const { id: _id, recordedAt: _recordedAt, ...verified } = inserted;
    void _id; void _recordedAt;
    assert.equal(verifyPayrollCalculationEvidence(verified), true);
    assert.equal(Object.hasOwn(inserted.trace as object, "payment"), false);

    // A second direct write for the same job+employee must never duplicate.
    await expectPostgresRejection(() => db.insert(payrollCalculationHistory)
      .values({ ...first, revision: 2, previousSnapshotHash: first.snapshotHash }),
    /payroll_calculation_history_job_employee_unique/);
    await expectPostgresRejection(() => db.insert(payrollCalculationHistory).values({
      ...first, payrollJobId: jobB.id, revision: 2, previousSnapshotHash: first.snapshotHash,
    }), /PAYROLL_HISTORY_SCOPE_OR_SOURCE_MISMATCH/);
    await expectPostgresRejection(() => db.insert(payrollCalculationHistory).values({
      ...first, employeeId: workerB.id,
    }), /PAYROLL_HISTORY_SCOPE_OR_SOURCE_MISMATCH/);

    const [jobA2] = await db.insert(payrollJobs).values({
      organizationId: alpha.id, payrollRunId: runA.id, status: "processing",
    }).returning();
    const { snapshotHash: _previous, ...originalEvidence } = first;
    void _previous;
    const second = createPayrollCalculationEvidence({
      ...originalEvidence, payrollJobId: jobA2.id, revision: 2, previousSnapshotHash: first.snapshotHash,
      grossPay: "10250.00", netPay: "9250.00",
    });
    await expectPostgresRejection(() => db.insert(payrollCalculationHistory).values({
      ...second, revision: 4,
    }), /PAYROLL_HISTORY_REVISION_CHAIN_INVALID/);
    await expectPostgresRejection(() => db.insert(payrollCalculationHistory).values({
      ...second, previousSnapshotHash: "0".repeat(64),
    }), /PAYROLL_HISTORY_REVISION_CHAIN_INVALID/);
    await db.insert(payrollCalculationHistory).values(second);
    const prior = await db.select().from(payrollCalculationHistory)
      .where(eq(payrollCalculationHistory.payrollRunId, runA.id));
    assert.deepEqual(prior.map(row => row.revision).sort(), [1, 2]);

    await assert.rejects(() => pool.query(
      "UPDATE public.payroll_calculation_history SET net_pay = '0' WHERE id=$1",
      [inserted.id],
    ), /PAYROLL_CALCULATION_HISTORY_IMMUTABLE/);
    await assert.rejects(() => pool.query(
      "DELETE FROM public.payroll_calculation_history WHERE id=$1", [inserted.id],
    ), /PAYROLL_CALCULATION_HISTORY_IMMUTABLE/);
    await assert.rejects(() => pool.query(
      "TRUNCATE TABLE public.payroll_calculation_history",
    ), /PAYROLL_CALCULATION_HISTORY_IMMUTABLE/);

    // No FKs from history to replaceable payroll runs, employees or jobs.
    await db.delete(payrollRuns).where(eq(payrollRuns.id, runA.id));
    assert.equal((await db.select().from(payrollCalculationHistory)
      .where(eq(payrollCalculationHistory.payrollRunId, runA.id))).length, 2);
    assert.equal((await db.select().from(payrollCalculationHistory)
      .where(eq(payrollCalculationHistory.organizationId, beta.id))).length, 0);
    const firstRead = (await db.select().from(payrollCalculationHistory)
      .where(eq(payrollCalculationHistory.id, inserted.id)))[0];
    assert.equal(firstRead.netPay, "9000.00");

    // Explicit whole-tenant erasure must still work under the FK cascade.
    await db.delete(organizations).where(eq(organizations.id, alpha.id));
    createdOrgs.splice(createdOrgs.indexOf(alpha.id), 1);
    assert.equal((await db.select().from(payrollCalculationHistory)
      .where(eq(payrollCalculationHistory.organizationId, alpha.id))).length, 0);
  } finally {
    for (const id of createdOrgs) {
      await db.delete(organizations).where(eq(organizations.id, id));
    }
    await pool.end();
  }
});
