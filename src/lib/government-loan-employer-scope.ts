export type LegalEmployerOption = {
  id: number;
  code: string | null;
  displayName: string;
  active: true;
  primaryEntity: boolean;
};

// A foreign or partial legal-employer directory is never an implicit choice.
export function parseAuthorizedLegalEmployers(value: unknown, organizationId: number): LegalEmployerOption[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (body.organizationId !== organizationId || !Array.isArray(body.legalEntities) ||
      body.legalEntities.length > 1000) return null;
  const ids = new Set<number>();
  const result: LegalEmployerOption[] = [];
  for (const value of body.legalEntities) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    if (typeof row.id !== "number" || !Number.isSafeInteger(row.id) || row.id <= 0 ||
        ids.has(row.id) || typeof row.displayName !== "string" || !row.displayName.trim() ||
        !(row.code === null || typeof row.code === "string") ||
        typeof row.primaryEntity !== "boolean" || row.active !== true) return null;
    ids.add(row.id);
    result.push({
      id: row.id, code: row.code as string | null, displayName: row.displayName,
      primaryEntity: row.primaryEntity, active: true,
    });
  }
  return result;
}

