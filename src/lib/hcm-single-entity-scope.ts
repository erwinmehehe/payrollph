import { eq } from "drizzle-orm";
import { db } from "@/db";
import { legalEntities } from "@/db/schema";

/**
 * Stop newly added HCM cross-entity reads until approved employer grants exist.
 * A companyWide org-unit permission is NOT a legal-entity group HR grant.
 */
export async function singleLegalEntityForTenant(organizationId: number): Promise<number | null> {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) return null;
  const rows = await db.select({ id: legalEntities.id }).from(legalEntities)
    .where(eq(legalEntities.organizationId, organizationId)).limit(2);
  return rows.length === 1 ? rows[0].id : null;
}
