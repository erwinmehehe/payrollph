import type { ClientConfig } from "pg";

export declare const CATALOG_AUDITOR_GUARD_SQL: string;
export type CatalogAuditorProof = Readonly<{
  catalogOnly: true;
  payrollRowsQueried: false;
  migrationReceiptsVerified: false;
  productionReleaseApproved: false;
}>;
export function catalogAuditorConnectionOptions(
  value: string | undefined, expectedDatabase: string | undefined,
): ClientConfig;
export function verifyCatalogAuditorFlags(
  row: unknown, options?: { requireJournals?: boolean },
): CatalogAuditorProof;
export function assertCatalogAuditorPrivilegeBoundary(
  client: { query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }> },
  options?: { expectedDatabase?: string; requireJournals?: boolean },
): Promise<CatalogAuditorProof>;
