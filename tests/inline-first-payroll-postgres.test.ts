import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

let isolated = false;
try {
  const url = new URL(process.env.DATABASE_URL ?? "");
  isolated = process.env.CI === "true" && process.env.GITHUB_ACTIONS === "true" && ["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname === "/app_db";
} catch { /* No disposable database configured. */ }

test("PostgreSQL tenant journey resumes for a second member and preview mutates no records", { skip: !isolated }, async () => {
  const { and, eq, sql } = await import("drizzle-orm");
  const { db } = await import("../src/db");
  const { organizations, users, userOrganizations, employees, employeePayProfiles, workforceAttendancePeriodLocks } = await import("../src/db/schema");
  const { readFirstPayrollProgress, saveFirstPayrollProgress } = await import("../src/lib/first-payroll-progress-server");
  const { loadFirstPayrollPreview } = await import("../src/lib/first-payroll-preview-server");
  const suffix = randomUUID();
  const [tenant, foreign] = await db.insert(organizations).values([
    { name: "Journey synthetic " + suffix, legalName: "Journey synthetic" },
    { name: "Foreign journey " + suffix, legalName: "Foreign synthetic" },
  ]).returning();
  const [owner, hr] = await db.insert(users).values([
    { name: "Synthetic Owner", email: `journey-owner-${suffix}@example.test`, role: "owner", passwordHash: "never-login" },
    { name: "Synthetic HR", email: `journey-hr-${suffix}@example.test`, role: "hr", passwordHash: "never-login" },
  ]).returning();
  const schedule = { periodStart: "2026-10-01", periodEnd: "2026-10-15", payDate: "2026-10-15" };
  try {
    await db.insert(userOrganizations).values([
      { organizationId: tenant.id, userId: owner.id, role: "owner" },
      { organizationId: tenant.id, userId: hr.id, role: "hr" },
    ]);
    const empty = await loadFirstPayrollPreview(tenant.id);
    assert.equal(empty.previewReady, false);
    assert.match(empty.blockers.join(" "), /No pay schedule/);
    await saveFirstPayrollProgress({ organizationId: tenant.id, step: "company", ownerRole: "owner", actorId: owner.id, schedule });
    await saveFirstPayrollProgress({ organizationId: tenant.id, step: "people", ownerRole: "hr", actorId: owner.id });
    await saveFirstPayrollProgress({ organizationId: foreign.id, step: "people", ownerRole: "hr", actorId: owner.id });
    const resumed = await readFirstPayrollProgress(tenant.id);
    assert.equal(resumed.length, 2);
    assert.equal(resumed.find(s => s.step === "people")?.ownerRole, "hr");
    assert.equal(resumed.find(s => s.step === "people")?.updatedBy, "Synthetic Owner");
    await saveFirstPayrollProgress({ organizationId: tenant.id, step: "company", ownerRole: "payroll", actorId: hr.id });
    const handed = await readFirstPayrollProgress(tenant.id);
    assert.deepEqual((handed.find(s => s.step === "company")?.data as { schedule: unknown }).schedule, schedule);
    assert.equal(handed.find(s => s.step === "company")?.updatedBy, "Synthetic HR");
    assert.equal((await readFirstPayrollProgress(foreign.id)).length, 1);
    const [worker] = await db.insert(employees).values({ organizationId: tenant.id, employeeNo: "JOURNEY-SYN", firstName: "Journey", lastName: "Worker", title: "Staff", avatarInitials: "JW", basicRate: "30000", startDate: "2026-10-01", tin: "synthetic-only", bankAccount: "synthetic-only", bankCode: "BDO", restDay: "Sunday" }).returning();
    await db.insert(employeePayProfiles).values({ organizationId: tenant.id, employeeId: worker.id, payBasis: "monthly", rateAmount: "30000", standardWorkDaysPerMonth: "22", standardHoursPerDay: "8" });
    assert.equal((await loadFirstPayrollPreview(tenant.id)).previewReady, false, "Setup cannot self-approve time");
    await db.insert(workforceAttendancePeriodLocks).values({ organizationId: tenant.id, ...{ periodStart: schedule.periodStart, periodEnd: schedule.periodEnd }, lockType: "payroll_cutoff", reason: "Synthetic authorized human review", lockedBy: hr.name, lockedByUserId: hr.id });
    const snapshot = async () => (await db.execute(sql`SELECT
      (SELECT count(*) FROM payroll_runs) AS runs,
      (SELECT count(*) FROM payroll_entries) AS entries,
      (SELECT count(*) FROM payslips) AS payslips,
      (SELECT count(*) FROM payroll_jobs) AS jobs,
      (SELECT count(*) FROM compensation_events) AS ledger,
      (SELECT count(*) FROM audit_events) AS audit,
      (SELECT jsonb_agg(to_jsonb(p)) FROM first_payroll_journey_progress p WHERE p.organization_id = ${tenant.id}) AS progress,
      (SELECT jsonb_agg(to_jsonb(e)) FROM employees e WHERE e.organization_id = ${tenant.id}) AS employees`)).rows;
    const before = await snapshot();
    const ready = await loadFirstPayrollPreview(tenant.id);
    assert.equal(ready.previewReady, true, ready.blockers.join(" "));
    assert.equal(ready.rows[0].gross, 15000);
    assert.equal(ready.rows[0].name, "Journey Worker");
    assert.deepEqual(await snapshot(), before, "Dry run cannot change runs, register, ledger, payslips, jobs, audit, progress or employee data");
    assert.deepEqual((await loadFirstPayrollPreview(foreign.id)).rows, []);
    await assert.rejects(db.transaction(tx => tx.execute(sql`UPDATE organizations SET name = name WHERE id = ${tenant.id}`), { accessMode: "read only" }), /read-only|read only/i);
    await db.delete(employees).where(and(eq(employees.id, worker.id), eq(employees.organizationId, tenant.id)));
  } finally {
    await db.delete(organizations).where(eq(organizations.id, tenant.id));
    await db.delete(organizations).where(eq(organizations.id, foreign.id));
    await db.delete(users).where(eq(users.id, owner.id));
    await db.delete(users).where(eq(users.id, hr.id));
  }
});
