import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { employeeWorksiteAssignments, hcmWorkArrangements, hcmWorksiteAuthorizations, worksites } from "@/db/schema";
import { evaluateSiteEligibility } from "@/lib/hcm-worksite-eligibility";

export async function loadSiteEligibilityEvidence(organizationId: number, employeeIds: number[], executor: Pick<typeof db, "select"> = db) {
  const ids = [...new Set(employeeIds)].filter((id) => Number.isInteger(id) && id > 0);
  const [sites, primary, arrangements, authorizations] = await Promise.all([
    executor.select({ id: worksites.id, siteType: worksites.siteType, active: worksites.active })
      .from(worksites).where(eq(worksites.organizationId, organizationId)),
    ids.length ? executor.select().from(employeeWorksiteAssignments)
      .where(and(eq(employeeWorksiteAssignments.organizationId, organizationId), inArray(employeeWorksiteAssignments.employeeId, ids)))
      : Promise.resolve([]),
    ids.length ? executor.select().from(hcmWorkArrangements)
      .where(and(eq(hcmWorkArrangements.organizationId, organizationId), inArray(hcmWorkArrangements.employeeId, ids)))
      : Promise.resolve([]),
    ids.length ? executor.select().from(hcmWorksiteAuthorizations)
      .where(and(eq(hcmWorksiteAuthorizations.organizationId, organizationId), inArray(hcmWorksiteAuthorizations.employeeId, ids)))
      : Promise.resolve([]),
  ]);
  return {
    sites,
    primaryAssignments: primary.map((row) => ({
      id: row.id, employeeId: row.employeeId, worksiteId: row.worksiteId, decision: row.decision as "allow" | "deny",
      effectiveFrom: String(row.effectiveFrom), effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
    })),
    arrangements: arrangements.map((row) => ({
      id: row.id, employeeId: row.employeeId, mode: row.mode,
      effectiveFrom: String(row.effectiveFrom), effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
    })),
    authorizations: authorizations.map((row) => ({
      id: row.id, employeeId: row.employeeId, worksiteId: row.worksiteId,
      effectiveFrom: String(row.effectiveFrom), effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
    })),
  };
}

export async function employeeSiteEligibility(input: {
  organizationId: number; employeeId: number; date: string; worksiteId: number | null;
  executor?: Pick<typeof db, "select">;
}) {
  const evidence = await loadSiteEligibilityEvidence(input.organizationId, [input.employeeId], input.executor ?? db);
  return evaluateSiteEligibility({ ...evidence, employeeId: input.employeeId, date: input.date, worksiteId: input.worksiteId });
}
