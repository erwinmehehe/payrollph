import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { legalEntities } from "@/db/schema";

export type ComplianceLegalEntity = typeof legalEntities.$inferSelect;

export async function listComplianceLegalEntities(organizationId: number) {
  return db.select().from(legalEntities)
    .where(eq(legalEntities.organizationId, organizationId))
    .orderBy(asc(legalEntities.code), asc(legalEntities.id));
}

export async function resolveComplianceLegalEntity(input: {
  organizationId: number;
  requestedLegalEntityId?: number | null;
  authoritativeLegalEntityId?: number | null;
}) {
  const rows = await listComplianceLegalEntities(input.organizationId);
  if (rows.length === 0) {
    throw new Error("No legal employer is configured for this organization.");
  }

  const requested =
    Number.isInteger(input.authoritativeLegalEntityId)
      ? Number(input.authoritativeLegalEntityId)
      : Number.isInteger(input.requestedLegalEntityId)
        ? Number(input.requestedLegalEntityId)
        : null;

  if (requested !== null) {
    const entity = rows.find((row) => row.id === requested);
    if (!entity) {
      throw new Error("The selected legal employer does not belong to this organization.");
    }
    return entity;
  }

  const active = rows.filter((row) => row.active);
  if (active.length === 1) return active[0]!;
  if (rows.length === 1) return rows[0]!;

  throw new Error(
    "legalEntityId is required because this organization has multiple legal employers. Compliance evidence must be recorded for one legal employer at a time.",
  );
}

export function legalEntityAuditMetadata(entity: ComplianceLegalEntity) {
  return {
    legalEntityId: entity.id,
    legalEntityCode: entity.code,
    legalEntityName: entity.legalName,
  };
}
