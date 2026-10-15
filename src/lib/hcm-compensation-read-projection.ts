/**
 * Client-safe, explicit projection of HCM compensation catalogs.
 *
 * The source query may contain employer-wide pay budgets, statutory IDs,
 * bank instructions, workforce-plan budgets and internal notes. Those fields
 * must not pass straight through JSON serialization, especially for unit HR.
 * This is read-only; financial authorization stays inside the POST/PATCH API.
 */

export type CompensationCatalogAccess = Readonly<{
  organizationId: number;
  orgUnitId: number | null;
  companyWide: boolean;
}>;

export type CompensationVisibleWorker = Readonly<{
  id: number;
  organizationId: number;
  orgUnitId: number | null;
  legalEntityId: number | null;
  region: string | null;
  jobProfileId: number | null;
  gradeId: number | null;
  salaryBand: { id: number } | null;
}>;

export type CompensationCatalogInput = {
  access: CompensationCatalogAccess;
  workers: readonly CompensationVisibleWorker[];
  proposals: readonly { employeeId: number; bandId: number }[];
  assignments: readonly { employeeId: number; positionId: number }[];
  positions: readonly {
    id: number; organizationId: number; code: string;
    jobProfileId: number; orgUnitId: number | null;
    legalEntityId: number | null; status: string;
    plannedStartDate: string | null;
  }[];
  jobProfiles: readonly {
    id: number; organizationId: number; title: string;
    family: string; level: string; gradeId: number | null;
    grade: string | null; active: boolean;
  }[];
  jobGrades: readonly {
    id: number; organizationId: number; code: string;
    name: string; sequence: number; active: boolean;
  }[];
  legalEntities: readonly {
    id: number; organizationId: number; code: string;
    displayName: string; active: boolean;
  }[];
  bands: readonly {
    id: number; organizationId: number; jobProfileId: number | null;
    gradeId: number | null; legalEntityId: number | null;
    locationCode: string; currency: string;
    minimumAnnual: string; midpointAnnual: string; maximumAnnual: string;
    effectiveFrom: string; effectiveUntil: string | null; active: boolean;
  }[];
  cycles: readonly {
    id: number; organizationId: number; name: string;
    startDate: string; endDate: string; effectiveDate: string;
    status: string; budgetPool: string;
  }[];
};

const validId = (id: number | null): id is number =>
  typeof id === "number" && Number.isSafeInteger(id) && id > 0;

/**
 * Return only the fields the compensation UI needs. Unknown fields from a
 * new schema revision must never be implicitly exposed to the browser.
 */
export function projectCompensationReadCatalogs(input: CompensationCatalogInput) {
  const { access } = input;
  const validScope = validId(access.organizationId) &&
    (access.companyWide || validId(access.orgUnitId));
  const workers = validScope ? input.workers.filter((row) =>
    row.organizationId === access.organizationId &&
    (access.companyWide || row.orgUnitId === access.orgUnitId)
  ) : [];
  const workerIds = new Set(workers.map((row) => row.id));
  const authorizedPositionIds = new Set(input.assignments
    .filter((row) => workerIds.has(row.employeeId))
    .map((row) => row.positionId));
  const sourcePositions = validScope ? input.positions.filter((row) =>
    row.organizationId === access.organizationId &&
    (access.companyWide ||
      (row.orgUnitId === access.orgUnitId && access.orgUnitId !== null) ||
      authorizedPositionIds.has(row.id))
  ) : [];

  const legalIds = new Set<number>();
  const profileIds = new Set<number>();
  const gradeIds = new Set<number>();
  const bandIds = new Set<number>();
  const locations = new Set<string>(["PH"]);

  for (const row of workers) {
    if (validId(row.legalEntityId)) legalIds.add(row.legalEntityId);
    if (validId(row.jobProfileId)) profileIds.add(row.jobProfileId);
    if (validId(row.gradeId)) gradeIds.add(row.gradeId);
    if (row.salaryBand && validId(row.salaryBand.id)) bandIds.add(row.salaryBand.id);
    if (row.region) locations.add(row.region.toUpperCase());
  }
  for (const row of sourcePositions) {
    if (validId(row.legalEntityId)) legalIds.add(row.legalEntityId);
    if (validId(row.jobProfileId)) profileIds.add(row.jobProfileId);
  }
  for (const row of input.proposals) {
    if (workerIds.has(row.employeeId) && validId(row.bandId)) bandIds.add(row.bandId);
  }
  for (const profile of input.jobProfiles) {
    if (profile.organizationId === access.organizationId &&
        profileIds.has(profile.id) && validId(profile.gradeId)) {
      gradeIds.add(profile.gradeId);
    }
  }

  const visibleBands = validScope ? input.bands.filter((band) => {
    if (band.organizationId !== access.organizationId) return false;
    if (access.companyWide) return true;
    if (bandIds.has(band.id)) return true; // Already linked to a visible worker/proposal.
    const roleMatches = validId(band.jobProfileId)
      ? profileIds.has(band.jobProfileId)
      : validId(band.gradeId) && gradeIds.has(band.gradeId);
    const employerMatches = band.legalEntityId === null || legalIds.has(band.legalEntityId);
    return roleMatches && employerMatches && locations.has(band.locationCode.toUpperCase());
  }) : [];
  for (const band of visibleBands) {
    if (validId(band.jobProfileId)) profileIds.add(band.jobProfileId);
    if (validId(band.gradeId)) gradeIds.add(band.gradeId);
    if (validId(band.legalEntityId)) legalIds.add(band.legalEntityId);
  }

  return {
    // The cycle identity and dates remain usable for governed unit-scoped HR
    // proposals; the organization budget is NOT disclosed or replaced by zero.
    cycles: validScope ? input.cycles
      .filter((row) => row.organizationId === access.organizationId)
      .map((row) => ({
        id: row.id,
        name: row.name,
        startDate: row.startDate,
        endDate: row.endDate,
        effectiveDate: row.effectiveDate,
        status: row.status,
        budgetPool: access.companyWide ? row.budgetPool : null,
      })) : [],
    // Position annualBudget, managerial notes and staffing plans are not
    // compensation-screen inputs. Do not serialize any of them.
    positions: sourcePositions.map((row) => ({
      id: row.id, code: row.code, jobProfileId: row.jobProfileId,
      orgUnitId: row.orgUnitId, legalEntityId: row.legalEntityId,
      status: row.status, plannedStartDate: row.plannedStartDate,
    })),
    // Legal-entity TIN/SSS/PhilHealth/Pag-IBIG and bank fields are never part
    // of the compensation selector payload, even for company-wide HR.
    legalEntities: validScope ? input.legalEntities
      .filter((row) => row.organizationId === access.organizationId &&
        (access.companyWide || legalIds.has(row.id)))
      .map((row) => ({ id: row.id, code: row.code, displayName: row.displayName })) : [],
    bands: visibleBands.map((row) => ({
      id: row.id, jobProfileId: row.jobProfileId, gradeId: row.gradeId,
      legalEntityId: row.legalEntityId, locationCode: row.locationCode,
      currency: row.currency, minimumAnnual: row.minimumAnnual,
      midpointAnnual: row.midpointAnnual, maximumAnnual: row.maximumAnnual,
      effectiveFrom: row.effectiveFrom, effectiveUntil: row.effectiveUntil,
      active: row.active,
    })),
    jobProfiles: validScope ? input.jobProfiles
      .filter((row) => row.organizationId === access.organizationId &&
        (access.companyWide || profileIds.has(row.id)))
      .map((row) => ({
        id: row.id, title: row.title, family: row.family,
        level: row.level, gradeId: row.gradeId, grade: row.grade,
        active: row.active,
      })) : [],
    jobGrades: validScope ? input.jobGrades
      .filter((row) => row.organizationId === access.organizationId &&
        (access.companyWide || gradeIds.has(row.id)))
      .map((row) => ({
        id: row.id, code: row.code, name: row.name,
        sequence: row.sequence, active: row.active,
      })) : [],
  };
}
