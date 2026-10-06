import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { legalEntities, organizations } from "@/db/schema";

export async function ensurePrimaryLegalEntity(
  organizationId: number,
  createdByUserId?: number | null,
) {
  const existing = await db.select().from(legalEntities)
    .where(eq(legalEntities.organizationId, organizationId))
    .orderBy(asc(legalEntities.id));

  if (existing.length > 0) {
    return existing.find((entity) => entity.primaryEntity) ?? existing[0];
  }

  const [organization] = await db.select().from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!organization) return null;

  await db.insert(legalEntities).values({
    organizationId,
    code: "PRIMARY",
    legalName: organization.legalName,
    displayName: organization.name,
    birTin: organization.birTin,
    birBranchCode: organization.birBranchCode,
    sssEmployerNo: organization.sssEmployerNo,
    philHealthEmployerNo: organization.philHealthEmployerNo,
    pagIbigEmployerNo: organization.pagIbigEmployerNo,
    statutoryDeductionTiming: organization.statutoryDeductionTiming,
    payrollCalendarMode: organization.payrollCalendarMode,
    primaryEntity: true,
    active: true,
    createdByUserId: createdByUserId ?? null,
  }).onConflictDoNothing({
    target: [legalEntities.organizationId, legalEntities.code],
  });

  const rows = await db.select().from(legalEntities)
    .where(and(
      eq(legalEntities.organizationId, organizationId),
      eq(legalEntities.active, true),
    ))
    .orderBy(asc(legalEntities.id));
  return rows.find((entity) => entity.primaryEntity) ?? rows[0] ?? null;
}
