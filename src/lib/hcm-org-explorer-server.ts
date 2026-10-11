import { and, asc, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { employees, jobProfiles, orgUnits, positionAssignments, positions } from "@/db/schema";
import { orgExplorerBusinessDate, projectOrgExplorer, projectPositionHistory } from "@/lib/hcm-org-explorer-projection";
import type { HcmOrgExplorerResponse, HcmPositionHistoryResponse } from "@/lib/hcm-org-explorer-contract";

/** Hard ceilings prevent a partial hierarchy/position inventory being shown as complete. */
export const HCM_ORG_EXPLORER_UNIT_LIMIT = 250;
export const HCM_ORG_EXPLORER_POSITION_LIMIT = 500;
export const HCM_POSITION_HISTORY_LIMIT = 50;

export class OrgExplorerPreviewLimitError extends Error {
  constructor() { super("Organization explorer preview ceiling exceeded"); }
}

/** Caller has already enforced company-wide People role and session policy. */
export async function loadHcmOrgExplorer(organizationId: number): Promise<HcmOrgExplorerResponse> {
  const today = orgExplorerBusinessDate();
  const [unitRows, positionRows] = await Promise.all([
    db.select({
      id: orgUnits.id,
      parentId: orgUnits.parentId,
      code: orgUnits.code,
      name: orgUnits.name,
      type: orgUnits.type,
    }).from(orgUnits).where(and(
      eq(orgUnits.organizationId, organizationId),
      eq(orgUnits.active, true),
      or(isNull(orgUnits.effectiveFrom), lte(orgUnits.effectiveFrom, today)),
      or(isNull(orgUnits.effectiveUntil), gte(orgUnits.effectiveUntil, today)),
    )).orderBy(asc(orgUnits.id)).limit(HCM_ORG_EXPLORER_UNIT_LIMIT + 1),

    db.select({
      id: positions.id,
      code: positions.code,
      status: positions.status,
      orgUnitId: positions.orgUnitId,
      supervisoryOrgUnitId: positions.supervisoryOrgUnitId,
      jobTitle: jobProfiles.title,
    }).from(positions)
      .leftJoin(jobProfiles, and(
        eq(positions.jobProfileId, jobProfiles.id),
        eq(jobProfiles.organizationId, organizationId),
      ))
      .where(eq(positions.organizationId, organizationId))
      .orderBy(asc(positions.id))
      .limit(HCM_ORG_EXPLORER_POSITION_LIMIT + 1),
  ]);

  if (unitRows.length > HCM_ORG_EXPLORER_UNIT_LIMIT ||
      positionRows.length > HCM_ORG_EXPLORER_POSITION_LIMIT) {
    // Never report a truncated hierarchy as a complete/accurate org chart.
    throw new OrgExplorerPreviewLimitError();
  }
  return {
    tenantId: organizationId,
    observedAt: new Date().toISOString(),
    currentBusinessDate: today,
    sources: ["org_units", "positions", "job_profiles"],
    ...projectOrgExplorer(unitRows, positionRows),
  };
}

/**
 * Historical source is the position_assignments ledger. Mutable job profiles
 * and position org-unit fields are explicitly labeled CURRENT only.
 */
export async function loadHcmPositionHistory(
  organizationId: number,
  positionId: number,
): Promise<HcmPositionHistoryResponse | null> {
  const [position] = await db.select({
    id: positions.id,
    code: positions.code,
    status: positions.status,
    currentJobTitle: jobProfiles.title,
  }).from(positions)
    .leftJoin(jobProfiles, and(
      eq(positions.jobProfileId, jobProfiles.id),
      eq(jobProfiles.organizationId, organizationId),
    ))
    .where(and(
      eq(positions.organizationId, organizationId),
      eq(positions.id, positionId),
    )).limit(1);
  if (!position) return null;

  const rows = await db.select({
    id: positionAssignments.id,
    // Return a worker reference only after verifying the target employer.
    employeeId: employees.id,
    assignmentType: positionAssignments.assignmentType,
    effectiveFrom: positionAssignments.effectiveFrom,
    effectiveUntil: positionAssignments.effectiveUntil,
  }).from(positionAssignments)
    .leftJoin(employees, and(
      eq(positionAssignments.employeeId, employees.id),
      eq(employees.organizationId, organizationId),
    ))
    .where(and(
      eq(positionAssignments.organizationId, organizationId),
      eq(positionAssignments.positionId, positionId),
    ))
    .orderBy(desc(positionAssignments.effectiveFrom), desc(positionAssignments.id))
    .limit(HCM_POSITION_HISTORY_LIMIT + 1);

  return {
    tenantId: organizationId,
    positionId,
    observedAt: new Date().toISOString(),
    position: { source: "positions", ...position },
    history: {
      source: "position_assignments",
      preview: projectPositionHistory(rows, HCM_POSITION_HISTORY_LIMIT),
    },
  };
}
