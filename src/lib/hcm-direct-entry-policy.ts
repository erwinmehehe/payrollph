import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { hcmBusinessProcessDefinitions } from "@/db/schema";

/**
 * A configured hire approval policy is binding even if the current version
 * is disabled, future-dated, expired, or limited to one supervisory unit.
 * Direct employee creation lacks a reviewed position/supervisory scope and
 * cannot safely infer that a tenant intended to waive the approved hire path.
 *
 * Tenants without an explicitly configured hire BP retain legacy standalone
 * onboarding/import while they plan a phased migration.
 */
export async function hasConfiguredHireBusinessProcess(organizationId: number): Promise<boolean> {
  const [definition] = await db.select({ id: hcmBusinessProcessDefinitions.id })
    .from(hcmBusinessProcessDefinitions)
    .where(and(
      eq(hcmBusinessProcessDefinitions.organizationId, organizationId),
      eq(hcmBusinessProcessDefinitions.processType, "hire"),
    ))
    .limit(1);
  return Boolean(definition);
}

export const GOVERNED_HIRE_REQUIRED = {
  code: "HCM_GOVERNED_HIRE_REQUIRED",
  error: "This workspace uses a governed Hire business process. Use Recruitment > Hire & onboard so the approved position, candidate, salary and onboarding are recorded together. Direct employee creation and bulk hiring are disabled.",
} as const;
