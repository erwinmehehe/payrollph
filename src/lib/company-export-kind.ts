/**
 * Exact export-kind whitelist. An unknown selector must NEVER fall through to
 * the full JSON payload, which contains sensitive payroll and audit records.
 * This boundary applies even when multi-entity is disabled.
 */
export const COMPANY_EXPORT_KINDS = ["employees", "payroll", "audit", "all"] as const;
export type CompanyExportKind = typeof COMPANY_EXPORT_KINDS[number];

export function parseCompanyExportKind(value: string | null): CompanyExportKind | null {
  if (value === null) return "all";
  return COMPANY_EXPORT_KINDS.find(kind => kind === value) ?? null;
}

/**
 * Require one explicit, canonical positive tenant identifier for exports.
 * Duplicate query selectors are rejected by the API before this parser.
 */
export function parseCompanyExportOrganizationId(value: string | null): number | null {
  if (value === null || !/^[1-9][0-9]*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

/** A single-kind export must not load unrelated sensitive tables. */
export function companyExportSources(kind: CompanyExportKind) {
  return {
    employees: kind === "employees" || kind === "all",
    payrollRuns: kind === "payroll" || kind === "all",
    auditEvents: kind === "audit" || kind === "all",
  };
}
