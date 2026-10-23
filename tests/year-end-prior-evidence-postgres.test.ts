import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
const enabled = (() => { try { const u = new URL(process.env.DATABASE_URL ?? ""); return process.env.CI === "true" && process.env.BIR_2316_POSTGRES_QA === "true" && ["127.0.0.1", "localhost"].includes(u.hostname) && u.pathname === "/app_db"; } catch { return false; } })();
test("disposable PostgreSQL: encrypted revision/checker/tenant/transfer/bound-state and annualization", { skip: !enabled }, async () => {
  const { db, pool } = await import("../src/db");
  const { organizations, employees, users, auditEvents, payrollRuns, payrollEntries, yearEndAdjustments, yearEndPriorEvidence, legalEntities } = await import("../src/db/schema");
  const { priorIntake } = await import("../src/lib/year-end-prior-evidence-server");
  const { runYearEndAnnualization } = await import("../src/lib/year-end");
  const ids: number[] = [], actors: number[] = [];
  const previous = process.env.YEAR_END_PRIOR_EVIDENCE_ENABLED;
  try {
    for (let i = 0; i < 2; i++) { const [o] = await db.insert(organizations).values({ name: "Fictional prior " + randomUUID(), legalName: "Fictional" }).returning(); ids.push(o.id); }
    for (let i = 0; i < 2; i++) { const [u] = await db.insert(users).values({ name: "Fictional checker", email: randomUUID() + "@example.test", passwordHash: "not-login" }).returning(); actors.push(u.id); }
    const [employee] = await db.insert(employees).values({ organizationId: ids[0], employeeNo: "FICT", firstName: "Fictional", lastName: "Worker", title: "QA", avatarInitials: "FW", basicRate: "50000", startDate: "2025-07-01" }).returning();
    const scope = { organizationId: ids[0], employeeId: employee.id, taxYear: 2025 }, maker = { id: actors[0], name: "Fictional maker" }, checker = { id: actors[1], name: "Fictional checker" };
    const evidence = { status: "verified", employerName: "Fictional Previous", employerTin: "123456789-0000", periodFrom: "2025-01-01", periodTo: "2025-06-30", taxableIncome: "100000.00", taxWithheld: "10000.00", exemptBenefits: "0.00", sourceReference: "private:source", sourceSha256: "a".repeat(64), peraCredit: "100.00", peraReference: "private:pera", peraSha256: "b".repeat(64) };
    delete process.env.YEAR_END_PRIOR_EVIDENCE_ENABLED;
    await assert.rejects(priorIntake(scope, maker), /PRIOR_DISABLED/);
    process.env.YEAR_END_PRIOR_EVIDENCE_ENABLED = "true";
    assert.equal(await priorIntake(scope, maker), null);
    await assert.rejects(priorIntake({ ...scope, organizationId: ids[1] }, maker), /EMPLOYEE_NOT_FOUND/);
    await priorIntake(scope, maker, { action: "save", evidence, expectedDigest: "" });
    let record = await priorIntake(scope, maker) as { digest: string; revision: number; approved: boolean };
    const [stored] = await db.select().from(yearEndPriorEvidence).where(eq(yearEndPriorEvidence.organizationId, ids[0]));
    assert.ok(stored.encryptedEvidence.startsWith("enc:govid:v1:")); assert.ok(!stored.encryptedEvidence.includes("123456789"));
    await assert.rejects(priorIntake(scope, maker, { action: "approve", expectedDigest: record.digest }), /INDEPENDENT/);
    await assert.rejects(priorIntake(scope, checker, { action: "approve", expectedDigest: "stale" }), /SOURCE_CHANGED/);
    await priorIntake(scope, checker, { action: "approve", expectedDigest: record.digest });
    await priorIntake(scope, maker, { action: "save", evidence: { ...evidence, sourceSha256: "c".repeat(64) }, expectedDigest: record.digest });
    record = await priorIntake(scope, maker) as typeof record;
    assert.equal(record.revision, 2); assert.equal(record.approved, false);
    await priorIntake(scope, checker, { action: "approve", expectedDigest: record.digest });
    // Employee transfers invalidate the reviewed fingerprint, even within tenant.
    const [entity] = await db.insert(legalEntities).values({ organizationId: ids[0], code: "FICT", legalName: "Fictional", displayName: "Fictional" }).returning();
    await db.update(employees).set({ legalEntityId: entity.id }).where(eq(employees.id, employee.id));
    await assert.rejects(priorIntake(scope, checker), /SOURCE_CHANGED/);
    await db.update(employees).set({ legalEntityId: null }).where(eq(employees.id, employee.id));
    const [run] = await db.insert(payrollRuns).values({ organizationId: ids[0], periodLabel: "Fictional", periodStart: "2025-07-01", periodEnd: "2025-12-31", payDate: "2025-12-31", status: "Released" }).returning();
    await db.insert(payrollEntries).values({ payrollRunId: run.id, employeeId: employee.id, grossPay: "600000", deductions: "40000", netPay: "560000", lineItems: [{ code: "BASIC", amount: 600000 }, { code: "WHT", label: "Withholding tax", amount: -40000 }] });
    await runYearEndAnnualization(ids[0], 2025, maker.name);
    const [adjustment] = await db.select().from(yearEndAdjustments).where(eq(yearEndAdjustments.organizationId, ids[0]));
    assert.equal(Number(adjustment.taxWithheld), 40000);
    assert.equal(Number(adjustment.taxDue), 82500); // present taxable 600k + prior 100k
    assert.equal(Number(adjustment.adjustment), 32400);
    assert.ok((adjustment.breakdown as { priorEvidence?: unknown }).priorEvidence);
    const [secondEntity] = await db.insert(legalEntities).values({ organizationId: ids[0], code: "SECOND", legalName: "Fictional second employer", displayName: "Fictional second" }).returning();
    await assert.rejects(runYearEndAnnualization(ids[0], 2025, maker.name), /PRIOR_MULTI_ENTITY_DEFERRED/);
    await db.delete(legalEntities).where(eq(legalEntities.id, secondEntity.id));
    delete process.env.YEAR_END_PRIOR_EVIDENCE_ENABLED;
    await assert.rejects(runYearEndAnnualization(ids[0], 2025, maker.name), /PRIOR_EVIDENCE_DISABLED_RECOMPUTE_BLOCKED/);
    assert.equal((await db.select().from(yearEndAdjustments).where(eq(yearEndAdjustments.id, adjustment.id)))[0].adjustment, adjustment.adjustment);
    process.env.YEAR_END_PRIOR_EVIDENCE_ENABLED = "true";
    await db.update(yearEndAdjustments).set({ status: "approved", payrollRunId: run.id }).where(eq(yearEndAdjustments.id, adjustment.id));
    await assert.rejects(runYearEndAnnualization(ids[0], 2025, maker.name), /YEAR_END_BOUND_OR_APPROVED_RECOMPUTE_BLOCKED/);
    await assert.rejects(priorIntake(scope, maker, { action: "save", evidence, expectedDigest: record.digest }), /SETTLED_OR_BOUND/);
    await db.update(yearEndAdjustments).set({ status: "computed", payrollRunId: null }).where(eq(yearEndAdjustments.id, adjustment.id));
    await db.update(yearEndAdjustments).set({ status: "settled" }).where(eq(yearEndAdjustments.id, adjustment.id));
    await assert.rejects(priorIntake(scope, maker, { action: "save", evidence, expectedDigest: record.digest }), /SETTLED_OR_BOUND/);
    await assert.rejects(runYearEndAnnualization(ids[0], 2025, maker.name), /already been settled/);
    assert.equal((await db.select().from(yearEndAdjustments).where(eq(yearEndAdjustments.id, adjustment.id)))[0].adjustment, adjustment.adjustment);
    const audits = await db.select().from(auditEvents).where(eq(auditEvents.organizationId, ids[0]));
    assert.ok(!JSON.stringify(audits.map(a => a.metadata)).includes(evidence.employerTin));
    // A tenant mismatch must also be rejected by the database constraint.
    await assert.rejects(db.insert(yearEndPriorEvidence).values({ organizationId: ids[1], employeeId: employee.id, taxYear: 2025, encryptedEvidence: stored.encryptedEvidence, sourceDigest: "d".repeat(64), makerUserId: maker.id }));
  } finally {
    if (previous === undefined) delete process.env.YEAR_END_PRIOR_EVIDENCE_ENABLED; else process.env.YEAR_END_PRIOR_EVIDENCE_ENABLED = previous;
    if (ids.length) {
      await db.delete(yearEndPriorEvidence).where(inArray(yearEndPriorEvidence.organizationId, ids));
      await db.delete(yearEndAdjustments).where(inArray(yearEndAdjustments.organizationId, ids));
      const runs = await db.select({ id: payrollRuns.id }).from(payrollRuns).where(inArray(payrollRuns.organizationId, ids));
      if (runs.length) await db.delete(payrollEntries).where(inArray(payrollEntries.payrollRunId, runs.map(r => r.id)));
      await db.delete(payrollRuns).where(inArray(payrollRuns.organizationId, ids));
      await db.delete(employees).where(inArray(employees.organizationId, ids));
      await db.delete(legalEntities).where(inArray(legalEntities.organizationId, ids));
      // Audit 0109 seals an immutable append-only chain. Retain the fictional
      // employer anchors plus their audit records until this CI-only database
      // is discarded; do not delete sealed evidence or relax the trigger.
    }
    if (actors.length) await db.delete(users).where(inArray(users.id, actors));
    await pool.end();
  }
});
