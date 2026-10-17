import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { generateSchemaManifest } from "../lib/issue-1031-schema-manifest";
import type { SchemaManifest } from "../../src/lib/issue-1031-full-schema-diff";

// Metadata-only dependency hints. No DB connection, DDL, row access or migration.
export const RECOVERY_SCOPE = "CATALOG_TABLE_PRESENCE_ONLY_NOT_SCHEMA_ARCHIVE" as const;

export type CatalogInventory = {
  formatVersion: 1; evidenceScope: typeof RECOVERY_SCOPE; observedDateUTC: string;
  project: string; branchId: string; database: string; postgresMajor: number;
  publicTableCount: number; publicForeignKeyCount: number;
  sourceDeclaredTableCount: number; sourceSchemaGitBlobSha: string;
  rowDataIncluded: false; schemaOnlyArchiveIncluded: false;
  fullSchemaEquivalenceVerified: false; tables: string[];
};

export function planRecoveredSchema(catalog: CatalogInventory, schema: SchemaManifest) {
  if (catalog.formatVersion !== 1 || catalog.evidenceScope !== RECOVERY_SCOPE
    || catalog.rowDataIncluded !== false || catalog.schemaOnlyArchiveIncluded !== false
    || catalog.fullSchemaEquivalenceVerified !== false || catalog.postgresMajor !== 18) {
    throw new Error("INVALID_OR_OVERCLAIMED_RECOVERY_CATALOG");
  }
  if (!/^[a-f0-9]{40}$/.test(catalog.sourceSchemaGitBlobSha)) {
    throw new Error("MISSING_SOURCE_BLOB_ID");
  }
  // SHA-1 Git blob identity pins the exact schema bytes; table count alone
  // cannot distinguish a changed column/FK declaration.
  const sourceBytes = readFileSync(resolve(process.cwd(), "src/db/schema.ts"));
  const actualBlobSha = createHash("sha1")
    .update("blob " + sourceBytes.byteLength + "\0")
    .update(sourceBytes).digest("hex");
  if (actualBlobSha !== catalog.sourceSchemaGitBlobSha) {
    throw new Error("SOURCE_SCHEMA_BLOB_DRIFT_REQUIRES_NEW_CATALOG_CAPTURE");
  }
  if (!Array.isArray(catalog.tables) || !Number.isSafeInteger(catalog.publicTableCount)
    || catalog.tables.length !== catalog.publicTableCount
    || catalog.sourceDeclaredTableCount !== schema.tables.length) {
    throw new Error("INCOMPLETE_OR_STALE_RECOVERY_CATALOG");
  }
  const observed = new Set<string>();
  for (const name of catalog.tables) {
    if (typeof name !== "string" || !/^[a-z_][a-z0-9_]{0,62}$/.test(name)
      || observed.has(name)) throw new Error("INVALID_OR_DUPLICATED_TABLE_NAME");
    observed.add(name);
  }
  const declared = new Map(schema.tables.map(table => [table.name, table]));
  const missing = [...declared.keys()].filter(name => !observed.has(name)).sort();
  const extra = [...observed].filter(name => !declared.has(name)).sort();
  // This graph is only a review hint; it cannot validate column drift,
  // historical SQL order, RLS, triggers, data, index shape or release safety.
  const dependencies = new Map(missing.map(name => [
    name,
    [...new Set(declared.get(name)!.foreignKeys
      .map(fk => fk.refTable).filter(ref => ref !== name && !observed.has(ref)))].sort(),
  ] as const));
  const pending = new Set(missing);
  const planned = new Set<string>();
  const phases: Array<{ phase: number; tables: string[] }> = [];
  while (pending.size) {
    const ready = [...pending].filter(name =>
      dependencies.get(name)!.every(ref => planned.has(ref))
    ).sort();
    if (!ready.length) break;
    for (const name of ready) { pending.delete(name); planned.add(name); }
    phases.push({ phase: phases.length + 1, tables: ready });
  }
  return {
    kind: "recovered-neon-catalog-dependency-review",
    evidenceScope: RECOVERY_SCOPE,
    observedDateUTC: catalog.observedDateUTC,
    source: schema.source,
    sourceSchemaGitBlobSha: catalog.sourceSchemaGitBlobSha,
    summary: {
      declared: schema.tables.length,
      observed: observed.size,
      observedForeignKeys: catalog.publicForeignKeyCount,
      matchingSourceTableNames: schema.tables.length - missing.length,
      missingDeclaredTables: missing.length,
      extraLegacyTables: extra.length,
    },
    missingDeclaredTables: missing,
    extraLegacyTables: extra,
    prerequisitePhases: phases,
    cyclicalOrUnresolvedTables: [...pending].sort(),
    missingCompensationAutomationIntents: missing.includes("compensation_automation_intents"),
    recoveryTestedAgainstActualNeonDump: false,
    applicationRowsQueried: false,
    productionOrNeonChanged: false,
    migrationHistoryVerified: false,
    repairSqlApproved: false,
    productionReleaseApproved: false,
    disposition: "BLOCKED_NEEDS_DBA_REVIEW_AND_SANITIZED_SCHEMA_ONLY_REPLAY",
  };
}

if (process.argv[1]?.endsWith("recovered-schema-plan.ts")) {
  const catalog = JSON.parse(readFileSync(resolve(process.cwd(),
    "qa/recovery/recovered-neon-20261017.catalog.json"), "utf8")) as CatalogInventory;
  process.stdout.write(JSON.stringify(planRecoveredSchema(catalog, generateSchemaManifest()), null, 2) + "\n");
}
