import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";

const isolated = (() => {
  if (process.env.CI !== "true" || process.env.GITHUB_ACTIONS !== "true" ||
      process.env.HRIS_JOURNEY_ACCEPTANCE_MODE !== "synthetic-postgres-only") return false;
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    return ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/app_db";
  } catch { return false; }
})();

test("disposable PG16: owner -> HR -> payroll resume, ready preview, zero payroll writes", { skip: !isolated }, async () => {
  const { db } = await import("../src/db");
  const { organizations, users, userOrganizations, legalEntities, employees, employeePayProfiles,
    firstPayrollJourneyProgress, auditEvents, payrollRuns, payrollEntries, payslips } =
    await import("../src/db/schema");
  const { ensurePrimaryLegalEntity } = await import("../src/lib/legal-entity");
  const { saveJourneyProgress, readJourneyProgress } = await import("../src/lib/first-payroll-progress");
  const { loadReadOnlyFirstPayrollPreview } = await import("../src/lib/first-payroll-preview");
  const { loadCanonicalFirstPayrollPreview } = await import("../src/lib/first-payroll-canonical-preview");
  const { encryptBankAccount } = await import("../src/lib/bank-account-crypto");
  const { encryptGovernmentId } = await import("../src/lib/government-id-crypto");

  const suffix = randomUUID().slice(0, 8);
  const [tenant] = await db.insert(organizations).values({
    name: "Disposable First Payroll " + suffix, legalName: "Disposable First Payroll " + suffix,
    payrollCalendarMode: "ph_semi_monthly",
  }).returning({ id: organizations.id });
  try {
    const people = await db.insert(users).values(["owner","hr","payroll","checker","bookkeeper"].map(role => ({
      email: `first-payroll-${role}-${suffix}@example.test`,
      name: "Synthetic " + role, role, passwordHash: "synthetic-do-not-login",
    }))).returning({ id: users.id, name: users.name, role: users.role });
    await db.insert(userOrganizations).values(people.map(person => ({
      userId: person.id, organizationId: tenant.id, role: person.role, active: true,
    })));
    const [owner, hr, payroll, checker, finance] = people;
    const employer = await ensurePrimaryLegalEntity(tenant.id, owner.id);
    assert.ok(employer?.id);
    assert.equal(employer?.payrollCalendarMode, "ph_semi_monthly");

    assert.equal(await readJourneyProgress(tenant.id), null);
    await saveJourneyProgress({ organizationId:tenant.id, userId:owner.id, userName:owner.name,
      role:"owner",key:"company",action:"company_confirm" });
    await saveJourneyProgress({ organizationId:tenant.id, userId:owner.id, userName:owner.name,
      role:"owner",key:"time",action:"handoff",targetRole:"hr" });
    const hrResume = await readJourneyProgress(tenant.id);
    assert.equal(hrResume?.stepOwners.time, "hr");
    assert.equal(hrResume?.completedSteps.company.byUserId, owner.id);
    await assert.rejects(saveJourneyProgress({ organizationId:tenant.id,
      userId:owner.id,userName:owner.name,role:"owner",key:"time",action:"time_review",
      periodStart:"2026-10-01",periodEnd:"2026-10-15",acknowledged:true }), /HR/);
    await saveJourneyProgress({ organizationId:tenant.id, userId:hr.id, userName:hr.name,
      role:"hr",key:"time",action:"time_review",periodStart:"2026-10-01",
      periodEnd:"2026-10-15",acknowledged:true });
    const payrollResume = await readJourneyProgress(tenant.id);
    assert.equal(payrollResume?.completedSteps.company.byUserId, owner.id);
    assert.equal(payrollResume?.completedSteps.time.byUserId, hr.id);
    assert.equal(payrollResume?.completedSteps.time.periodEnd, "2026-10-15");
    await assert.rejects(saveJourneyProgress({
      organizationId:tenant.id, userId:checker.id,userName:checker.name,role:"checker",
      key:"payroll",action:"handoff",targetRole:"bookkeeper",
    }),/responsible role|administrator/);
    await saveJourneyProgress({
      organizationId:tenant.id, userId:payroll.id,userName:payroll.name,role:"payroll",
      key:"payroll",action:"handoff",targetRole:"bookkeeper",
    });
    assert.equal((await readJourneyProgress(tenant.id))?.stepOwners.payroll,"bookkeeper");
    const financeResume = await readJourneyProgress(tenant.id);
    assert.equal(financeResume?.completedSteps.time.byUserId, hr.id);
    assert.equal(finance?.role, "bookkeeper");

    const [person] = await db.insert(employees).values({
      organizationId:tenant.id, legalEntityId:employer!.id,
      employeeNo:"FP-0001", firstName:"Synthetic", lastName:"Worker", title:"Staff",
      avatarInitials:"SW", basicRate:"30000.00", status:"Active", region:"NCR",
      restDay:"Sunday", startDate:"2026-01-01", mwe:false,
      tin:encryptGovernmentId("123456789"), bankCode:"BPI",
      bankAccount:encryptBankAccount("synthetic-00001234"),
    }).returning({ id: employees.id });
    await db.insert(employeePayProfiles).values({ organizationId:tenant.id, employeeId:person.id,
      payBasis:"monthly",rateAmount:"30000.00",standardWorkDaysPerMonth:"22.00",standardHoursPerDay:"8.00" });

    const snapshot = async () => ({
      progress:(await db.select().from(firstPayrollJourneyProgress)
        .where(eq(firstPayrollJourneyProgress.organizationId,tenant.id))),
      runs:(await db.select({id:payrollRuns.id}).from(payrollRuns)
        .where(eq(payrollRuns.organizationId,tenant.id))),
      entries:(await db.select({id:payrollEntries.id}).from(payrollEntries)),
      payslips:(await db.select({id:payslips.id}).from(payslips)),
      audit:(await db.select().from(auditEvents).where(eq(auditEvents.organizationId,tenant.id))),
    });
    const before = await snapshot();
    const result = await db.transaction(async tx => {
      await tx.execute(sql`SET TRANSACTION READ ONLY`);
      return loadReadOnlyFirstPayrollPreview({
        organizationId:tenant.id,periodStart:"2026-10-01",
        periodEnd:"2026-10-15",payDate:"2026-10-15",
      }, tx as unknown as Pick<typeof db,"select">);
    });
    const canonicalResult = await db.transaction(async tx => {
      await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`);
      return loadCanonicalFirstPayrollPreview({
        organizationId: tenant.id, periodStart: "2026-10-01",
        periodEnd: "2026-10-15", payDate: "2026-10-15",
      }, tx as unknown as Pick<typeof db, "select">);
    });
    assert.equal(canonicalResult.dryRun, true);
    assert.equal(canonicalResult.persisted, false);
    assert.equal(canonicalResult.previewReady, true, JSON.stringify(canonicalResult.blockers));
    assert.equal(canonicalResult.rows.length, 1);
    assert.equal(canonicalResult.rows[0].gross, result.rows[0].gross);
    assert.equal(canonicalResult.rows[0].net, result.rows[0].net);
    const after = await snapshot();
    assert.deepEqual(after,before,"Read-only preview must leave payroll, payslips, progress and audit unchanged");
    assert.equal(result.dryRun,true);
    assert.equal(result.persisted,false);
    assert.equal(result.rows.length,1);
    assert.equal(result.previewReady,true,JSON.stringify(result.blockers));
    assert.ok((result.rows[0].gross??0)>0);
    assert.ok((result.rows[0].net??0)>=0);
    assert.equal((await db.select().from(payrollRuns).where(eq(payrollRuns.organizationId,tenant.id))).length,0);
    assert.equal((await db.select().from(payrollEntries)).length,before.entries.length);
    assert.equal(payroll.role,"payroll");
  } finally {
    await db.delete(employees).where(eq(employees.organizationId,tenant.id));
    await db.delete(organizations).where(eq(organizations.id,tenant.id));
  }
});
