import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { payrollRuns, userOrganizations } from "@/db/schema";

/** Resolve an addressed run only through the caller's active employer membership.
 * Missing and foreign-employer IDs both return null. This is not role, unit,
 * legal-employer, MFA or treasury authorization: callers retain those gates.
 */
export async function findPayrollRunForMember(userId: number, runId: number) {
  if (!Number.isSafeInteger(userId) || userId <= 0 ||
      !Number.isSafeInteger(runId) || runId <= 0) return null;
  const [row] = await db.select({ run: payrollRuns }).from(payrollRuns)
    .innerJoin(userOrganizations, and(
      eq(userOrganizations.organizationId, payrollRuns.organizationId),
      eq(userOrganizations.userId, userId),
      eq(userOrganizations.active, true),
    ))
    .where(eq(payrollRuns.id, runId)).limit(1);
  return row?.run ?? null;
}
