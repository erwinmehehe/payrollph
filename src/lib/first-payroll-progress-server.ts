import { eq } from "drizzle-orm";
import { db } from "@/db";
import { firstPayrollJourneyProgress, users } from "@/db/schema";
import type { FirstPayrollJourneyStep, JourneyRole, JourneySchedule } from "./first-payroll-journey";

export function readFirstPayrollProgress(organizationId: number, database = db) {
  return database.select({ step: firstPayrollJourneyProgress.step, ownerRole: firstPayrollJourneyProgress.ownerRole, data: firstPayrollJourneyProgress.data, updatedAt: firstPayrollJourneyProgress.updatedAt, updatedBy: users.name })
    .from(firstPayrollJourneyProgress).innerJoin(users, eq(users.id, firstPayrollJourneyProgress.updatedByUserId))
    .where(eq(firstPayrollJourneyProgress.organizationId, organizationId));
}

/** Authorization belongs to the route; only typed schedule/ownership is stored.
 * Completion and approval are always derived from their authoritative records. */
export async function saveFirstPayrollProgress(input: {
  organizationId: number; step: FirstPayrollJourneyStep["key"]; ownerRole: JourneyRole;
  actorId: number; schedule?: JourneySchedule;
}, database = db) {
  const patch = { ownerRole: input.ownerRole, updatedByUserId: input.actorId, updatedAt: new Date(), ...(input.schedule ? { data: { schedule: input.schedule } } : {}) };
  const [progress] = await database.insert(firstPayrollJourneyProgress).values({ organizationId: input.organizationId, step: input.step, ...patch })
    .onConflictDoUpdate({ target: [firstPayrollJourneyProgress.organizationId, firstPayrollJourneyProgress.step], set: patch }).returning();
  return progress;
}
