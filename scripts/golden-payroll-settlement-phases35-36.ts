import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { eq, asc } from "drizzle-orm";
import { requirePhase15Database, requirePhase15Environment } from "./qa/golden-phase15-safety";

async function main() {
  const mode = requirePhase15Environment(process.env);
  assert.ok(!process.env.EXACT_PAYROLL_LOAN_SETTLEMENT_ENABLED ||
    process.env.EXACT_PAYROLL_LOAN_SETTLEMENT_ENABLED === "false");
  const { db, pool } = await import("../src/db");
  try {
    const { rows: [identity] } = await pool.query(`select current_setting('server_version_num')::int as version,
      current_database() as database, host(inet_server_addr()) as "serverAddress",
      host(inet_client_addr()) as "clientAddress", (select count(*)::int from organizations) as employers`);
    requirePhase15Database(identity, mode);
    const s = await import("../src/db/schema");
    const { enqueuePayrollRun, drainPayrollQueue } = await import("../src/lib/payroll-engine");
    const { settlePayrollRun } = await import("../src/lib/payroll-settlement");
    const [org] = await db.insert(s.organizations).values({
      name: "Fictional golden settlement", legalName: "Fictional golden settlement", plan: "Core", statutoryDeductionTiming: "split",
    }).returning();
    async function hire(name: string, mobile: string) {
      const [worker] = await db.insert(s.employees).values({
        organizationId: org.id, employeeNo: name, firstName: "Fictional", lastName: name, title: "QA",
        avatarInitials: "QA", basicRate: "30000.00", startDate: "2026-07-01", region: "NCR", mobile,
      }).returning();
      await db.insert(s.employeePayProfiles).values({
        organizationId: org.id, employeeId: worker.id, payBasis: "monthly",
        rateAmount: "30000.00", standardWorkDaysPerMonth: "22.00", standardHoursPerDay: "8.00",
      });
      return worker.id;
    }
    const loanWorker = await hire("P35-LOAN", "09990000000");
    const advanceWorker = await hire("P36-ADVANCE", "09990000001");
    const [loan] = await db.insert(s.employeeLoans).values({
      organizationId: org.id, employeeId: loanWorker, loanType: "Company loan", referenceNo: "P35-LOAN",
      principal: "2500.00", remainingBalance: "2500.00", totalPaid: "0.00", monthlyAmortization: "3000.00",
      cutoffDeduction: "1500.00", status: "active", startDate: "2026-07-01",
    }).returning();
    const [advance] = await db.insert(s.earnedWageRequests).values({
      organizationId: org.id, employeeId: advanceWorker,
      requestedAmount: "1000.00", fee: "50.00", status: "approved", decidedBy: "fictional-fixture",
    }).returning();

    // These amounts are fixture expectations expressed in centavos.
    const cutoffs = [
      { start: "2026-07-01", end: "2026-07-15", loan: -150000, balance: 100000, paid: 150000, status: "active", advance: -105000 },
      { start: "2026-07-16", end: "2026-07-31", loan: -100000, balance: 0, paid: 250000, status: "paid_off", advance: 0 },
      { start: "2026-08-01", end: "2026-08-15", loan: 0, balance: 0, paid: 250000, status: "paid_off", advance: 0 },
    ];
    const cents = (value: unknown) => {
      assert.ok(typeof value === "number" || typeof value === "string");
      assert.match(String(value), /^-?\d+(\.\d{1,2})?$/);
      return Math.round(Number(value) * 100);
    };
    const observations = [];
    let originalAdvanceRun: number | undefined;
    for (const cutoff of cutoffs) {
      const [run] = await db.insert(s.payrollRuns).values({
        organizationId: org.id, periodLabel: "Golden release " + cutoff.end, scopeLabel: "All locations",
        periodStart: cutoff.start, periodEnd: cutoff.end, payDate: cutoff.end, status: "Draft",
      }).returning();
      await enqueuePayrollRun(run.id, 25);
      await drainPayrollQueue(10, run.id);
      const entries = await db.select().from(s.payrollEntries).where(eq(s.payrollEntries.payrollRunId, run.id));
      assert.equal(entries.length, 2);
      function deduction(worker: number, code: string, expected: number) {
        const entry = entries.find(row => row.employeeId === worker);
        assert.ok(entry && Array.isArray(entry.lineItems));
        const items = entry.lineItems as Array<{code: string; amount: unknown}>;
        const lines = items.filter(item => item.code === code);
        assert.equal(lines.length, expected === 0 ? 0 : 1);
        const actual = lines.length ? cents(lines[0].amount) : 0;
        assert.equal(actual, expected, code + " at " + cutoff.end);
        return actual;
      }
      const loanDeduction = deduction(loanWorker, `LOAN-${loan.id}`, cutoff.loan);
      const advanceDeduction = deduction(advanceWorker, `EWA-${advance.id}`, cutoff.advance);
      // The fixture supplies the claim that the release endpoint normally makes.
      await db.update(s.payrollRuns).set({ status: "Releasing" }).where(eq(s.payrollRuns.id, run.id));
      const settled = await settlePayrollRun(run.id);
      assert.equal(settled.run.status, "Released");
      assert.equal(settled.settlement.loanPaymentsSettled, cutoff.loan ? 1 : 0);
      assert.equal(settled.settlement.advancesSettled, cutoff.advance ? 1 : 0);
      const [loanAfter] = await db.select().from(s.employeeLoans).where(eq(s.employeeLoans.id, loan.id));
      assert.equal(cents(loanAfter.remainingBalance), cutoff.balance);
      assert.equal(cents(loanAfter.totalPaid), cutoff.paid);
      assert.equal(loanAfter.status, cutoff.status);
      const [advanceAfter] = await db.select().from(s.earnedWageRequests).where(eq(s.earnedWageRequests.id, advance.id));
      assert.equal(advanceAfter.status, "repaid");
      originalAdvanceRun ??= run.id;
      assert.equal(advanceAfter.payrollRunId, originalAdvanceRun);
      await assert.rejects(settlePayrollRun(run.id), /no longer in the releasing state/);
      observations.push({ cutoff: cutoff.end, loanDeduction, balance: cents(loanAfter.remainingBalance),
        paid: cents(loanAfter.totalPaid), loanStatus: loanAfter.status, advanceDeduction, advanceRun: originalAdvanceRun });
    }
    const payments = await db.select().from(s.loanPayments).where(eq(s.loanPayments.loanId, loan.id)).orderBy(asc(s.loanPayments.paymentDate));
    assert.deepEqual(payments.map(row => [row.paymentDate, cents(row.amount)]),
      [["2026-07-15", 150000], ["2026-07-31", 100000]]);
    mkdirSync("qa-artifacts", { recursive: true });
    writeFileSync("qa-artifacts/golden-payroll-settlement-phases35-36.json",
      JSON.stringify({ postgresVersion: identity.version, cases: ["loan-settlement", "advance-single-recovery"], observations }, null, 2) + "\n");
    console.log("Golden settlement Phases 35 and 36 passed on fictional PG16.");
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
