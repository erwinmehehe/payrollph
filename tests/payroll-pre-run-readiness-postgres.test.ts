import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  employeePayProfiles, employeeRestDayRevisions, employees, legalEntities,
  organizations, payrollRuns, workforceTimesheets,
} from "../src/db/schema";
import { loadPayrollPreRunReadiness } from "../src/lib/payroll-pre-run-readiness-server";
import { buildStatutoryRuleWatch, philippineCalendarDay } from "../src/lib/statutory-rule-watch";

// Disposable, synthetic localhost PG ONLY; never run against hosted or Neon DB.
const disposable = (() => {
  const raw = process.env.DATABASE_URL;
  if (process.env.CI !== "true" || !raw) return false;
  const u = new URL(raw);
  return u.protocol === "postgresql:" && u.hostname === "127.0.0.1"
    && u.port === "5432" && u.pathname === "/app_db"
    && u.username === "postgres" && u.password === "postgres"
    && !u.search && !u.hash;
})();

test("real PostgreSQL pre-run loader scopes evidence to employer, employee, cutoff and conflicting legal entity", {
  skip: !disposable, timeout: 60_000,
}, async () => {
  assert.notEqual(process.env.XENDIT_PAYOUTS_ENABLED, "true");
  assert.notEqual(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "true");

  const [org] = await db.insert(organizations).values({
    name: "Fictional readiness " + randomUUID(), legalName: "Fictional readiness no money",
  }).returning({ id: organizations.id });
  const [foreignOrg] = await db.insert(organizations).values({
    name: "Fictional other tenant " + randomUUID(), legalName: "Fictional other tenant",
  }).returning({ id: organizations.id });
  try {
    const [entity] = await db.insert(legalEntities).values({
      organizationId: org.id, code: "FIC1", legalName: "Fictional Employer",
      displayName: "Fictional Employer", primaryEntity: true,
      payrollCalendarMode: "ph_semi_monthly",
    }).returning({ id: legalEntities.id });
    const [otherEntity] = await db.insert(legalEntities).values({
      organizationId: org.id, code: "FIC2", legalName: "Fictional Alternate Employer",
      displayName: "Fictional Alternate Employer",
    }).returning({ id: legalEntities.id });
    const [foreignEntity] = await db.insert(legalEntities).values({
      organizationId: foreignOrg.id, code: "OTHER", legalName: "Fictional Foreign",
      displayName: "Fictional Foreign",
    }).returning({ id: legalEntities.id });

    const people = await db.insert(employees).values([
      {
        organizationId: org.id, legalEntityId: entity.id, employeeNo: "FIC21",
        firstName: "Fictional", lastName: "First", avatarInitials: "FF",
        title: "Tester", basicRate: "20000.00", startDate: "2026-10-01",
      },
      {
        organizationId: org.id, legalEntityId: null, employeeNo: "FIC22",
        firstName: "Fictional", lastName: "Unassigned", avatarInitials: "FU",
        title: "Tester", basicRate: "22000.00", startDate: "2026-10-01",
      },
      {
        organizationId: foreignOrg.id, legalEntityId: foreignEntity.id, employeeNo: "FIC99",
        firstName: "Fictional", lastName: "OtherTenant", avatarInitials: "FO",
        title: "Tester", basicRate: "30000.00", startDate: "2026-10-01",
      },
    ]).returning({ id: employees.id, employeeNo: employees.employeeNo });
    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id, legalEntityId: entity.id,
      periodLabel: "Fictional readiness cutoff", periodStart: "2026-10-01",
      periodEnd: "2026-10-15", payDate: "2026-10-20", status: "Draft",
    }).returning();

    await db.insert(employeePayProfiles).values({
      organizationId: org.id, employeeId: people[0].id,
      payBasis: "monthly", rateAmount: "20000.00",
      standardWorkDaysPerMonth: "22", standardHoursPerDay: "8",
    });
    await db.insert(workforceTimesheets).values({
      organizationId: org.id, employeeId: people[0].id,
      periodStart: "2026-10-01", periodEnd: "2026-10-15",
      status: "approved", version: 1, snapshotHash: "synthetic-" + randomUUID(),
      decidedAt: new Date("2026-10-20T00:00:00Z"),
    });

    const first = await loadPayrollPreRunReadiness(run);
    const forWorker = (id: number) => first.findings.filter(f => f.employeeId === id).map(f => f.code);
    assert.deepEqual(forWorker(people[0].id), []);
    assert.ok(forWorker(people[1].id).includes("PRERUN_LEGAL_ENTITY_UNASSIGNED"));
    assert.ok(forWorker(people[1].id).includes("PRERUN_PAY_PROFILE_MISSING"));
    assert.ok(forWorker(people[1].id).includes("PRERUN_ATTENDANCE_MISSING"));
    assert.deepEqual(forWorker(people[2].id), [], "other tenant must never appear");
    // Compare with actual current rule-watch evidence, not a magic 4 that
    // would fail after legitimate future official verification is recorded.
    const statusCode: Record<string, string> = {
      "verification-unrecorded": "PRERUN_STATUTORY_VERIFICATION_UNRECORDED",
      "review-due": "PRERUN_STATUTORY_REVIEW_DUE",
      "update-overdue": "PRERUN_STATUTORY_UPDATE_OVERDUE",
      "no-coverage": "PRERUN_STATUTORY_NO_COVERAGE",
    };
    const today = philippineCalendarDay();
    const expected = buildStatutoryRuleWatch(today, today)
      .map(row => statusCode[row.status]).filter(Boolean).sort();
    const actual = first.findings
      .filter(f => f.code.startsWith("PRERUN_STATUTORY_")).map(f => f.code).sort();
    assert.deepEqual(actual, expected,
      "The read-only loader must expose every unresolved live statutory family");
    assert.ok(!actual.includes("PRERUN_STATUTORY_WATCH_INCOMPLETE"));

    // A separate legal employer with the same dates is not an overlapping run.
    await db.insert(payrollRuns).values({
      organizationId: org.id, legalEntityId: otherEntity.id,
      periodLabel: "Fictional separate employer", periodStart: "2026-10-01",
      periodEnd: "2026-10-15", payDate: "2026-10-20", status: "Draft",
    });
    const separate = await loadPayrollPreRunReadiness(run);
    assert.ok(!separate.findings.some(f => f.code === "PRERUN_PERIOD_OVERLAP"));

    await db.insert(employeeRestDayRevisions).values({
      organizationId: org.id, employeeId: people[0].id,
      effectiveDate: "2026-10-08", previousRestDay: "Sunday",
      newRestDay: "Friday", reason: "Synthetic effective-day correction",
    });
    const afterRevision = await loadPayrollPreRunReadiness(run);
    assert.ok(afterRevision.findings.some(f =>
      f.employeeId === people[0].id && f.code === "PRERUN_REST_DAY_REVISION_UNRESOLVED"));

    await db.insert(payrollRuns).values({
      organizationId: org.id, legalEntityId: entity.id,
      periodLabel: "Fictional overlapping same employer", periodStart: "2026-10-15",
      periodEnd: "2026-10-31", payDate: "2026-11-01", status: "Processing",
    });
    const afterOverlap = await loadPayrollPreRunReadiness(run);
    assert.ok(afterOverlap.findings.some(f => f.code === "PRERUN_PERIOD_OVERLAP"));
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
    await db.delete(organizations).where(eq(organizations.id, foreignOrg.id));
  }
});
