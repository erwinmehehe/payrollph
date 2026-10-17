import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { generateSchemaManifest } from "../lib/issue-1031-schema-manifest";
import type { SchemaManifest } from "../../src/lib/issue-1031-full-schema-diff";

// Metadata-only dependency hints. No DB connection, DDL, row access or migration.
export const RECOVERY_SCOPE = "CATALOG_TABLE_PRESENCE_ONLY_NOT_SCHEMA_ARCHIVE" as const;
export const ORIGINAL_RECOVERY_SOURCE_SHA = "111085f3161ef0a0d401f960833a9c9f1736dd13" as const;
export const RECOVERY_SOURCE_NAMES = "qa/recovery/recovered-neon-20261017.source-tables.json" as const;
export type RecoveryComparisonMode = "captured-source-strict" | "current-source-advisory";

export type CatalogInventory = {
  formatVersion: 1; evidenceScope: typeof RECOVERY_SCOPE; observedDateUTC: string;
  project: string; branchId: string; database: string; postgresMajor: number;
  publicTableCount: number; publicForeignKeyCount: number;
  sourceDeclaredTableCount: number; sourceSchemaGitBlobSha: string;
  rowDataIncluded: false; schemaOnlyArchiveIncluded: false;
  fullSchemaEquivalenceVerified: false; tables: string[];
};


/** Historical SQL mentions are candidate creators, NOT evidence of application. */
function historicalCreatorCandidates(missing: string[]) {
  const root = resolve(process.cwd(), "drizzle");
  const files = readdirSync(root).filter(name =>
    /^\d{4}_.+\.sql$/.test(name) || name === "baseline.sql"
  ).sort();
  if (files.length < 100) throw new Error("HISTORICAL_MIGRATION_FILES_MISSING");
  const missingSet = new Set(missing);
  const creators = new Map<string, string[]>();
  const pattern = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?public"?\.)?"?([A-Za-z0-9_]+)"?\s*\(/gi;
  for (const file of files) {
    const sql = readFileSync(resolve(root, file), "utf8").replace(/--.*$/gm, "");
    for (const match of sql.matchAll(pattern)) {
      const table = match[1]?.toLowerCase();
      if (!table || !missingSet.has(table)) continue;
      const list = creators.get(table) ?? [];
      list.push("drizzle/" + file);
      creators.set(table, list);
    }
  }
  const withCreator = missing.filter(name => creators.has(name));
  const withoutCreator = missing.filter(name => !creators.has(name));
  return {
    evidenceScope: "HISTORICAL_SQL_CREATE_TABLE_MENTION_NOT_APPLIED_RECEIPT",
    historicalFilesScanned: files.length,
    missingWithHistoricalCreator: withCreator,
    missingWithoutHistoricalCreator: withoutCreator,
    historicalFileCandidatesByTable: Object.fromEntries(
      withCreator.map(name => [name, [...new Set(creators.get(name)!)].sort()])
    ),
    appliedMigrationsVerified: false,
  };
}

export function planRecoveredSchema(catalog: CatalogInventory, schema: SchemaManifest, mode: RecoveryComparisonMode = "captured-source-strict") {
  if (catalog.formatVersion !== 1 || catalog.evidenceScope !== RECOVERY_SCOPE
    || catalog.rowDataIncluded !== false || catalog.schemaOnlyArchiveIncluded !== false
    || catalog.fullSchemaEquivalenceVerified !== false || catalog.postgresMajor !== 18) {
    throw new Error("INVALID_OR_OVERCLAIMED_RECOVERY_CATALOG");
  }
  if (mode !== "captured-source-strict" && mode !== "current-source-advisory") {
    throw new Error("INVALID_SOURCE_COMPARISON_MODE");
  }
  if (!/^[a-f0-9]{40}$/.test(catalog.sourceSchemaGitBlobSha)) {
    throw new Error("MISSING_SOURCE_BLOB_ID");
  }
  const capture = JSON.parse(readFileSync(resolve(process.cwd(),
    RECOVERY_SOURCE_NAMES), "utf8")) as {
      formatVersion: number; evidenceScope: string; capturedDateUTC: string;
      sourceSchemaGitBlobSha: string; declaredTableCount: number; tables: string[];
    };
  if (catalog.sourceSchemaGitBlobSha !== ORIGINAL_RECOVERY_SOURCE_SHA ||
    capture.sourceSchemaGitBlobSha !== ORIGINAL_RECOVERY_SOURCE_SHA ||
    capture.formatVersion !== 1 ||
    capture.evidenceScope !== "CAPTURED_SOURCE_TABLE_NAMES_ONLY_NOT_SOURCE_SCHEMA_ARCHIVE" ||
    capture.capturedDateUTC !== catalog.observedDateUTC) {
    throw new Error("CAPTURE_SOURCE_BLOB_PROVENANCE_MISMATCH");
  }
  if (!Array.isArray(capture.tables) || !Number.isSafeInteger(capture.declaredTableCount) ||
    capture.tables.length !== capture.declaredTableCount || capture.tables.length < 270 ||
    catalog.sourceDeclaredTableCount !== capture.declaredTableCount ||
    capture.tables.some((name, i) =>
      typeof name !== "string" || !/^[a-z_][a-z0-9_]{0,62}$/.test(name) ||
      (i > 0 && name <= capture.tables[i - 1]!))) {
    throw new Error("HISTORICAL_SOURCE_TABLE_NAMES_INCOMPLETE_OR_DUPLICATED");
  }
  // A current-source advisory comparison requires an explicit opt-in. The
  // original capture SHA remains immutable; we never claim this re-queries Neon.
  const sourceBytes = readFileSync(resolve(process.cwd(), "src/db/schema.ts"));
  const actualBlobSha = createHash("sha1")
    .update("blob " + sourceBytes.byteLength + "\0")
    .update(sourceBytes).digest("hex");
  const sourceChanged = actualBlobSha !== catalog.sourceSchemaGitBlobSha;
  if (sourceChanged && mode === "captured-source-strict") {
    throw new Error("SOURCE_SCHEMA_BLOB_DRIFT_REQUIRES_EXPLICIT_CURRENT_SOURCE_MODE");
  }
  if (!Array.isArray(catalog.tables) || !Number.isSafeInteger(catalog.publicTableCount) ||
    catalog.tables.length !== catalog.publicTableCount || schema.formatVersion !== 1 ||
    schema.source !== "src/db/schema.ts" || !Array.isArray(schema.tables) ||
    schema.tables.length < 270) {
    throw new Error("INCOMPLETE_OR_STALE_RECOVERY_CATALOG");
  }
  const observed = new Set<string>();
  for (const name of catalog.tables) {
    if (typeof name !== "string" || !/^[a-z_][a-z0-9_]{0,62}$/.test(name)
      || observed.has(name)) throw new Error("INVALID_OR_DUPLICATED_TABLE_NAME");
    observed.add(name);
  }
  const declared = new Map(schema.tables.map(table => [table.name, table]));
  if (declared.size !== schema.tables.length) {
    throw new Error("DUPLICATED_CURRENT_SOURCE_TABLE_NAMES");
  }
  const historicalDeclared = new Set(capture.tables);
  const historicalMissing = capture.tables.filter(name => !observed.has(name));
  const historicalExtra = [...observed].filter(name => !historicalDeclared.has(name)).sort();
  const addedNames = [...declared.keys()].filter(name => !historicalDeclared.has(name)).sort();
  const removedNames = capture.tables.filter(name => !declared.has(name));
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
    sourceComparison: {
      mode,
      capturedSourceGitBlobSha: catalog.sourceSchemaGitBlobSha,
      evaluatedCurrentSourceGitBlobSha: actualBlobSha,
      sourceChangedSinceCapture: sourceChanged,
      addedSourceTablesSinceCapture: addedNames,
      removedSourceTablesSinceCapture: removedNames,
      historicalSourceTableNamesPinned: true,
      historicalFullSchemaReplayed: false,
      catalogRequeriedFromNeon: false,
      comparisonIsAdvisory: mode === "current-source-advisory",
      independentReviewRequired: true,
    },
    historicalCaptureSummary: {
      declared: capture.tables.length,
      observed: observed.size,
      observedForeignKeys: catalog.publicForeignKeyCount,
      matchingSourceTableNames: capture.tables.length - historicalMissing.length,
      missingDeclaredTables: historicalMissing.length,
      extraLegacyTables: historicalExtra.length,
    },
    missingAtCaptureFromSource: historicalMissing,
    extraAtCaptureAgainstSource: historicalExtra,
    summary: {
      declared: schema.tables.length,
      observed: observed.size,
      observedForeignKeys: catalog.publicForeignKeyCount,
      matchingSourceTableNames: schema.tables.length - missing.length,
      missingDeclaredTables: missing.length,
      extraLegacyTables: extra.length,
    },
    historicalCreatorCoverage: historicalCreatorCandidates(missing),
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
  const flag = process.argv[2];
  if (flag !== undefined && flag !== "--compare-current-source") {
    throw new Error("INVALID_SOURCE_COMPARISON_MODE");
  }
  const mode: RecoveryComparisonMode =
    flag === "--compare-current-source" ? "current-source-advisory" : "captured-source-strict";
  process.stdout.write(JSON.stringify(planRecoveredSchema(catalog, generateSchemaManifest(), mode), null, 2) + "\n");
}
