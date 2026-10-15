import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
const enabled = (() => { try { const u = new URL(process.env.DATABASE_URL ?? ""); return process.env.CI === "true" && process.env.BIR_2316_POSTGRES_QA === "true" && ["127.0.0.1", "localhost"].includes(u.hostname) && u.pathname === "/app_db"; } catch { return false; } })();
test("disposable PostgreSQL: source isolation, immutable final pay and default-off readers execute read-only", { skip: !enabled }, async () => {
  const { db, pool } = await import("../src/db");
  const { organizations, legalEntities, employees, payrollRuns, payrollEntries, yearEndAdjustments, separationRecords, users } = await import("../src/db/schema");
  const { loadYearEnd2316Withholding, loadFinalPay2316Withholding } = await import("../src/lib/bir-2316-withholding-server");
  const { computeFinalPay } = await import("../src/lib/final-pay");
  const original = db.transaction.bind(db);
  const saved = [process.env.BIR_2316_RECONCILIATION_ENABLED, process.env.BIR_2316_WITHHOLDING_EVIDENCE_ENABLED];
  const orgIds: number[] = [], actorIds: number[] = [];
  try {
    for (const n of [1, 2]) { const [o] = await db.insert(organizations).values({ name: "FICTIONAL-2316-" + n + randomUUID(), legalName: "Fictional Legal Employer" }).returning(); orgIds.push(o.id); }
    const entities = [];
    const people = [];
    for (const id of orgIds) {
      const [e] = await db.insert(legalEntities).values({ organizationId: id, code: "FICT", legalName: "Fictional", displayName: "Fictional" }).returning(); entities.push(e);
      const [p] = await db.insert(employees).values({ organizationId: id, legalEntityId: e.id, employeeNo: "SAME-NUMBER", firstName: "Fictional", lastName: "Worker", title: "QA", avatarInitials: "FW", basicRate: "50000", startDate: "2025-01-01" }).returning(); people.push(p);
    }
    const [run] = await db.insert(payrollRuns).values({ organizationId: orgIds[0], legalEntityId: entities[0].id, periodLabel: "Fictional December", periodStart: "2025-12-01", periodEnd: "2025-12-31", payDate: "2025-12-31", status: "Released" }).returning();
    const [annual] = await db.insert(yearEndAdjustments).values({ organizationId: orgIds[0], employeeId: people[0].id, taxYear: 2025, grossCompensation: "10000.00", taxWithheld: "1000.00", adjustment: "200.00", payrollRunId: run.id, status: "settled" }).returning();
    const lines = [{ code: "WHT", amount: "-1000.00" }, { code: "YE-TAX-" + annual.id, amount: "-200.00" }];
    const [entry] = await db.insert(payrollEntries).values({ payrollRunId: run.id, employeeId: people[0].id, grossPay: "10000", deductions: "1200", netPay: "8800", lineItems: lines }).returning();
    // An intentionally inconsistent foreign-tenant run must not enter tenant A's totals.
    const [foreignRun] = await db.insert(payrollRuns).values({ organizationId: orgIds[1], legalEntityId: entities[1].id, periodLabel: "Foreign fictional run", periodStart: "2025-12-01", periodEnd: "2025-12-31", payDate: "2025-12-31", status: "Released" }).returning();
    await db.insert(payrollEntries).values({ payrollRunId: foreignRun.id, employeeId: people[0].id, grossPay: "1000", deductions: "999", netPay: "1", lineItems: [{ code: "WHT", amount: "-999.00" }] });
    const scope = { organizationId: orgIds[0], employeeId: people[0].id, legalEntityId: entities[0].id, taxYear: 2025, adjustmentId: annual.id, before: "1000.00", expectedAdjustment: "200.00" };
    // A disabled child or parent must return before requesting a transaction.
    db.transaction = (() => { throw new Error("Flag-off reader attempted DB transaction"); }) as typeof db.transaction;
    process.env.BIR_2316_RECONCILIATION_ENABLED = "true"; delete process.env.BIR_2316_WITHHOLDING_EVIDENCE_ENABLED;
    assert.equal(await loadYearEnd2316Withholding(scope), undefined);
    assert.equal(await loadFinalPay2316Withholding(orgIds[0], people[0].id, 1), undefined);
    process.env.BIR_2316_RECONCILIATION_ENABLED = "false"; process.env.BIR_2316_WITHHOLDING_EVIDENCE_ENABLED = "true";
    assert.equal(await loadYearEnd2316Withholding(scope), undefined);
    assert.equal(await loadFinalPay2316Withholding(orgIds[0], people[0].id, 1), undefined);
    process.env.BIR_2316_RECONCILIATION_ENABLED = "true";
    db.transaction = (() => Promise.reject(new Error("Synthetic private database details must not escape"))) as typeof db.transaction;
    const unavailable = await loadYearEnd2316Withholding(scope);
    assert.deepEqual(unavailable?.issues, ["WITHHOLDING_LOOKUP_UNAVAILABLE"]);
    assert.equal(unavailable?.actualPresentWithheld, null);
    let readTransactions = 0;
    db.transaction = ((callback, config) => original(async tx => {
      const state = await tx.execute(sql`show transaction_read_only`);
      assert.equal(state.rows[0].transaction_read_only, "on"); readTransactions++; return callback(tx);
    }, config)) as typeof db.transaction;
    assert.equal((await loadYearEnd2316Withholding(scope))?.actualPresentWithheld, "1200.00");
    assert.equal((await loadYearEnd2316Withholding({ ...scope, organizationId: orgIds[1] }))?.actualPresentWithheld, null);
    assert.equal((await loadYearEnd2316Withholding({ ...scope, employeeId: people[1].id }))?.actualPresentWithheld, null);
    assert.equal((await loadYearEnd2316Withholding({ ...scope, legalEntityId: entities[1].id }))?.actualPresentWithheld, null);
    assert.equal((await loadYearEnd2316Withholding({ ...scope, before: "1000.01" }))?.actualPresentWithheld, null);
    await db.update(payrollRuns).set({ status: "Approved" }).where(eq(payrollRuns.id, run.id));
    assert.equal((await loadYearEnd2316Withholding(scope))?.actualPresentWithheld, null);
    await db.update(payrollRuns).set({ status: "Released" }).where(eq(payrollRuns.id, run.id));
    for (let i = 0; i < 3; i++) { const [u] = await db.insert(users).values({ name: "Fictional reviewer", email: randomUUID() + "@example.test", passwordHash: "fictional-not-login" }).returning(); actorIds.push(u.id); }
    const final = computeFinalPay({ releasedBasicYtd: 600000, historicalBasicYtd: 0, unpaidBasicSalary: 1000, thirteenthPaidYtd: 50000, grossCompensationYtd: 600000, statutoryContributionsYtd: 0, taxWithheldYtd: 1200, mwe: false, leaveMonetizationPay: 0, separationPay: 0, retirementPay: 0, otherBenefits: 0, loanDeductions: 0 });
    const [separation] = await db.insert(separationRecords).values({ organizationId: orgIds[0], employeeId: people[0].id, separationType: "resignation", noticeDate: "2025-12-01", lastDay: "2025-12-31", status: "released", releasedAt: new Date("2025-12-31T02:00:00Z"), releaseReference: "Fictional legacy release", preparedByUserId: actorIds[0], approvedByUserId: actorIds[1], releasedByUserId: actorIds[2], taxAdjustment: String(final.taxAdjustment), grossFinalPay: String(final.grossFinalPay), netFinalPay: String(final.netFinalPay), computationSnapshot: { annualization: final.annualization, appliedTaxCollection: final.appliedTaxCollection, unpaidTaxWithholding: final.unpaidTaxWithholding, sourceFingerprint: { employeeLegalEntityId: entities[0].id, released: [{ entryId: entry.id, runId: run.id, payDate: run.payDate, lineItems: lines }] } } }).returning();
    const evidence = await loadFinalPay2316Withholding(orgIds[0], people[0].id, separation.id);
    assert.equal(Number(evidence?.actualPresentWithheld), 1200 + final.appliedTaxCollection);
    assert.ok(evidence?.issues.includes("UNSETTLED_ADJUSTMENT"));
    assert.equal((await loadFinalPay2316Withholding(orgIds[1], people[0].id, separation.id))?.actualPresentWithheld, null);
    await db.update(payrollEntries).set({ lineItems: [{ code: "WHT", amount: "-1001.00" }] }).where(eq(payrollEntries.id, entry.id));
    assert.equal((await loadFinalPay2316Withholding(orgIds[0], people[0].id, separation.id))?.actualPresentWithheld, null);
    assert.ok(readTransactions >= 9);
  } finally {
    db.transaction = original;
    for (const [i, name] of ["BIR_2316_RECONCILIATION_ENABLED", "BIR_2316_WITHHOLDING_EVIDENCE_ENABLED"].entries()) { if (saved[i] === undefined) delete process.env[name]; else process.env[name] = saved[i]; }
    if (orgIds.length) await db.delete(organizations).where(inArray(organizations.id, orgIds));
    if (actorIds.length) await db.delete(users).where(inArray(users.id, actorIds));
    await pool.end();
  }
});
