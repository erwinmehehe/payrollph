/**
 * Isolated sample-only compensation evidence for the official public demo.
 * This is invoked solely by a token-gated fictional HR scope acceptance login.
 * No real tenant, payroll run, pay revision, payment, or approval is touched.
 *
 * Tables must already exist through reviewed migrations. Never auto-migrate
 * production from a request handler just to make acceptance pass.
 */
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  compensationBands, compensationCycles, compensationProposals,
  employees, organizations, orgUnits,
} from "@/db/schema";
import { manilaCalendarDate } from "@/lib/payroll-period-ui";

export const PUBLIC_DEMO_COMPENSATION_CYCLE = "Public demo HR scope privacy #1046";
export const PUBLIC_DEMO_COMPENSATION_POOL = "876543.21";

export async function provisionPublicDemoCompensationScope(organizationId: number): Promise<number> {
  return db.transaction(async (tx) => {
    // Multiple independent GitHub Actions runs must never race the fixture.
    await tx.execute(sql.raw("select pg_advisory_xact_lock(hashtext('linaw-demo-compensation-1046'))"));

    const [organization] = await tx.select({ name: organizations.name })
      .from(organizations).where(eq(organizations.id, organizationId)).limit(1);
    const [otherOrganization] = await tx.select({ id: organizations.id })
      .from(organizations).where(ne(organizations.id, organizationId)).limit(1);
    if (!organization || organization.name !== "Loom & Local" || otherOrganization) {
      throw new Error("Compensation acceptance requires the isolated fictional demo tenant.");
    }

    const [unit] = await tx.select({
      id: orgUnits.id, effectiveFrom: orgUnits.effectiveFrom,
      effectiveUntil: orgUnits.effectiveUntil,
    }).from(orgUnits).where(and(
      eq(orgUnits.organizationId, organizationId),
      eq(orgUnits.code, "MKT"),
      eq(orgUnits.active, true),
    )).limit(1);
    const today = manilaCalendarDate();
    if (!unit || (unit.effectiveFrom && String(unit.effectiveFrom) > today) ||
        (unit.effectiveUntil && String(unit.effectiveUntil) < today)) {
      throw new Error("The fictional MKT unit must be active and effective.");
    }

    const [scopedWorker] = await tx.select({ id: employees.id }).from(employees).where(and(
      eq(employees.organizationId, organizationId),
      eq(employees.orgUnitId, unit.id),
    )).orderBy(employees.id).limit(1);
    const [otherWorker] = await tx.select({ id: employees.id }).from(employees).where(and(
      eq(employees.organizationId, organizationId),
      ne(employees.orgUnitId, unit.id),
    )).orderBy(employees.id).limit(1);
    if (!scopedWorker || !otherWorker) {
      throw new Error("Fictional demo must contain employees in at least two units.");
    }

    const [cycle] = await tx.insert(compensationCycles).values({
      organizationId,
      name: PUBLIC_DEMO_COMPENSATION_CYCLE,
      startDate: "2026-10-01",
      endDate: "2026-11-30",
      effectiveDate: "2026-12-15",
      status: "draft",
      budgetPool: PUBLIC_DEMO_COMPENSATION_POOL,
      createdBy: "Fictional demo privacy acceptance",
    }).onConflictDoUpdate({
      target: [
        compensationCycles.organizationId, compensationCycles.name,
        compensationCycles.startDate, compensationCycles.endDate,
      ],
      set: { status: "draft", budgetPool: PUBLIC_DEMO_COMPENSATION_POOL },
    }).returning({ id: compensationCycles.id });
    if (!cycle) throw new Error("Fictional demo compensation cycle is unavailable.");

    const ensureBand = async (code: string, minimumAnnual: string,
      midpointAnnual: string, maximumAnnual: string) => {
      const [existing] = await tx.select({ id: compensationBands.id })
        .from(compensationBands).where(and(
          eq(compensationBands.organizationId, organizationId),
          eq(compensationBands.locationCode, code),
          eq(compensationBands.effectiveFrom, "2026-01-01"),
          isNull(compensationBands.jobProfileId),
          isNull(compensationBands.gradeId),
          isNull(compensationBands.legalEntityId),
        )).limit(1);
      if (existing) return existing.id;
      const [created] = await tx.insert(compensationBands).values({
        organizationId, locationCode: code, effectiveFrom: "2026-01-01",
        minimumAnnual, midpointAnnual, maximumAnnual,
      }).returning({ id: compensationBands.id });
      if (!created) throw new Error("Fictional demo compensation band is unavailable.");
      return created.id;
    };

    const scopedBandId = await ensureBand("QA1046-UNIT", "200000.00", "300000.00", "400000.00");
    const otherBandId = await ensureBand("QA1046-OTHER", "800000.00", "900000.00", "1000000.00");
    // No approvals or revisions: purely proposed, fictional annual amounts.
    await tx.insert(compensationProposals).values([
      {
        organizationId, cycleId: cycle.id, employeeId: scopedWorker.id,
        bandId: scopedBandId, currentAnnual: "264000.00", proposedAnnual: "290000.00",
        reason: "QA1046 visible unit proposal", status: "proposed",
      },
      {
        organizationId, cycleId: cycle.id, employeeId: otherWorker.id,
        bandId: otherBandId, currentAnnual: "900000.00", proposedAnnual: "950000.00",
        reason: "QA1046 other unit private proposal", status: "proposed",
      },
    ]).onConflictDoNothing({
      target: [compensationProposals.cycleId, compensationProposals.employeeId],
    });

    return unit.id;
  });
}
