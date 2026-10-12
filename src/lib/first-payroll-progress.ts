import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, firstPayrollJourneyProgress, legalEntities } from "@/db/schema";
import { getAccess } from "@/lib/access";
import { parseMigrationDate } from "./migration-date";
import { FIRST_PAYROLL_STEPS, type FirstPayrollKey } from "./first-payroll-journey";

export type JourneyOwner = "owner" | "admin" | "hr" | "payroll" | "checker" | "bookkeeper";
export function isJourneyKey(value: unknown): value is FirstPayrollKey {
  return typeof value === "string" && FIRST_PAYROLL_STEPS.some(step => step.key === value);
}
export function canOwnJourneyStep(key: FirstPayrollKey, role: string) {
  return FIRST_PAYROLL_STEPS.find(step => step.key === key)?.allowedOwners.some(owner => owner === role) === true;
}
export async function readJourneyProgress(organizationId: number) {
  const [row] = await db.select().from(firstPayrollJourneyProgress)
    .where(eq(firstPayrollJourneyProgress.organizationId, organizationId)).limit(1);
  return row ?? null;
}
export type JourneyUpdate = {
  organizationId: number; userId: number; userName: string; role: string;
  key: FirstPayrollKey; action: "handoff" | "time_review" | "company_confirm";
  targetRole?: JourneyOwner;
  periodStart?: string; periodEnd?: string; acknowledged?: boolean;
};
/** Tenant-scoped, serialized and audit-atomic. No checklist state authorizes pay release. */
export async function saveJourneyProgress(input: JourneyUpdate) {
  const { organizationId, userId, role, key, action } = input;
  const access = await getAccess(userId, organizationId);
  if (!access?.companyWide || access.role !== role) throw Error("Company-wide authorized membership required.");
  if (action === "time_review" &&
      (key !== "time" || !canOwnJourneyStep(key, role) || input.acknowledged !== true ||
       !parseMigrationDate(input.periodStart) || !parseMigrationDate(input.periodEnd) ||
       input.periodStart! > input.periodEnd!))
    throw Error("An HR reviewer must explicitly attest the selected payroll period.");
  if (action === "company_confirm" && (key !== "company" || !canOwnJourneyStep(key, role)))
    throw Error("Employer setup confirmation requires an authorized administrator.");
  if (action === "handoff" && (!canOwnJourneyStep(key, input.targetRole ?? "") ||
      !["owner", "admin", "hr", "payroll", "checker", "bookkeeper"].includes(role)))
    throw Error("Invalid first-payroll role handoff.");

  return db.transaction(async tx => {
    // Protect concurrent owner, HR and finance saves from lost JSON updates.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(4213, ${organizationId})`);
    if (action === "company_confirm") {
      const employers = await tx.select({ id: legalEntities.id, primaryEntity: legalEntities.primaryEntity, active: legalEntities.active })
        .from(legalEntities).where(eq(legalEntities.organizationId, organizationId));
      if (!employers.some(entity => entity.active && entity.primaryEntity))
        throw Error("Configure the active primary legal employer before marking setup complete.");
    }
    const [old] = await tx.select().from(firstPayrollJourneyProgress)
      .where(eq(firstPayrollJourneyProgress.organizationId, organizationId)).limit(1);
    const now = new Date();
    const completedSteps = { ...(old?.completedSteps ?? {}) };
    const stepOwners = { ...(old?.stepOwners ?? {}) };
    if (action === "handoff") stepOwners[key] = input.targetRole!;
    else completedSteps[key] = {
      byUserId: userId, at: now.toISOString(),
      ...(action === "time_review" ? { periodStart: input.periodStart, periodEnd: input.periodEnd } : {}),
    };
    const record = {
      organizationId, stepOwners, completedSteps, updatedByUserId: userId, updatedAt: now,
      reviewedByUserId: action === "time_review" ? userId : old?.reviewedByUserId ?? null,
      reviewedAt: action === "time_review" ? now : old?.reviewedAt ?? null,
    };
    await tx.insert(firstPayrollJourneyProgress).values(record)
      .onConflictDoUpdate({ target: firstPayrollJourneyProgress.organizationId, set: record });
    await tx.insert(auditEvents).values({
      organizationId, actor: input.userName,
      action: action === "time_review" ? "First payroll period inputs reviewed"
        : action === "company_confirm" ? "First payroll employer setup confirmed"
        : "First payroll step handed off",
      resource: key,
      metadata: {
        key, action, role, targetRole: action === "handoff" ? input.targetRole : null,
        periodStart: action === "time_review" ? input.periodStart : null,
        periodEnd: action === "time_review" ? input.periodEnd : null,
      },
    });
    return record;
  });
}
