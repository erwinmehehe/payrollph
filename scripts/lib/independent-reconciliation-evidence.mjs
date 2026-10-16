import { isDeepStrictEqual } from "node:util";

/**
 * Evidence classification only. This module never suppresses a #1031 failure,
 * rewrites a migration, approves a waiver, or touches a database.
 */
export const RECOVERY_TABLES = Object.freeze([
  "attendance_exception_events", "employee_availability_rules",
  "open_shifts", "open_shift_claims", "compensation_bands",
  "compensation_cycles", "compensation_proposals", "compensation_components",
  "employee_compensation_components", "compensation_events",
]);

const targets = new Set(RECOVERY_TABLES);
const statuses = ["PASS", "MISSING", "DRIFT", "EXTRA"];

export function parse0128Renames(sql) {
  if (typeof sql !== "string" || !sql.length) throw new Error("0128 SQL source missing");
  const regex = /ALTER\s+TABLE\s+public\."([a-z_]+)"\s+RENAME\s+CONSTRAINT\s+"([a-z0-9_]+)"\s+TO\s+"([a-z0-9_]+)"\s*;/g;
  const mappings = [...sql.matchAll(regex)].map(m => ({
    table: m[1], oldName: m[2], newName: m[3],
  }));
  if (!mappings.length) throw new Error("0128 has no observed FK renames");
  const prior = new Set(), next = new Set();
  for (const m of mappings) {
    if (!targets.has(m.table)) throw new Error("0128 renamed a table outside recovery set");
    const old = m.table + "." + m.oldName, fresh = m.table + "." + m.newName;
    if (prior.has(old) || next.has(fresh) || old === fresh)
      throw new Error("0128 has duplicate or no-op FK names");
    prior.add(old); next.add(fresh);
  }
  return mappings;
}

const rowKey = row => JSON.stringify([
  row.table, row.kind, row.object, row.status, row.expected, row.actual,
]);
const sortRows = rows => rows.slice().sort((a,b) => rowKey(a).localeCompare(rowKey(b)));

export function compare1031Stages({ source, pre0128, post0128, mappings }) {
  for (const [name, stage] of Object.entries({ source, pre0128, post0128 })) {
    if (!stage || !Array.isArray(stage.nonPassing))
      throw new Error("Missing #1031 catalog stage: " + name);
    if (!stage.counts || !statuses.every(x => Number.isInteger(stage.counts[x])))
      throw new Error("Unknown #1031 count structure: " + name);
  }
  if (!Array.isArray(mappings) || mappings.length !== 49)
    throw new Error("Expected 49 explicitly mapped recovery FK renames");
  const base = new Set(source.nonPassing.map(rowKey));
  const before = new Set(pre0128.nonPassing.map(rowKey));
  const after = new Set(post0128.nonPassing.map(rowKey));

  const preNew = sortRows(pre0128.nonPassing.filter(r => !base.has(rowKey(r))));
  const postNew = sortRows(post0128.nonPassing.filter(r => !base.has(rowKey(r))));
  const mappingChecks = mappings.map(m => {
    const missing = pre0128.nonPassing.filter(r => r.table === m.table &&
      r.kind === "foreign_key" && r.object === m.newName && r.status === "MISSING");
    const extra = pre0128.nonPassing.filter(r => r.table === m.table &&
      r.kind === "foreign_key" && r.object === m.oldName && r.status === "EXTRA");
    const postOld = post0128.nonPassing.some(r => r.table === m.table &&
      r.kind === "foreign_key" && r.object === m.oldName);
    const postNew = post0128.nonPassing.some(r => r.table === m.table &&
      r.kind === "foreign_key" && r.object === m.newName);
    return {
      ...m, prePairObserved: missing.length === 1 && extra.length === 1,
      contractIdentical: missing.length === 1 && extra.length === 1 &&
        isDeepStrictEqual(missing[0].expected, extra[0].actual),
      postNamedObjectsNotFailing: !postOld && !postNew,
    };
  });
  const resolved = mappingChecks.filter(m => m.prePairObserved &&
    m.contractIdentical && m.postNamedObjectsNotFailing);
  const unresolved = mappingChecks.filter(m => !resolved.includes(m));
  const postRecovery = post0128.nonPassing.filter(r => targets.has(r.table));

  function category(row) {
    if ((row.kind === "column" || row.kind === "index") &&
        (row.status === "EXTRA" || row.status === "MISSING"))
      return "FORWARD_DDL_VS_SOURCE_MODEL_REVIEW";
    if (row.kind === "foreign_key" && row.status === "MISSING" &&
        targets.has(row.expected?.refTable) && !targets.has(row.table))
      return "POSSIBLE_SYNTHETIC_CASCADE_COLLATERAL_REVIEW";
    if (row.kind === "foreign_key")
      return "UNRESOLVED_FK_NAME_OR_CONTRACT_REVIEW";
    if (row.kind === "check" || row.kind === "unique_constraint")
      return "CONSTRAINT_CONTRACT_REVIEW";
    return "UNRESOLVED_OTHER_REVIEW";
  }
  const categorized = postNew.map(r => ({
    table: r.table, object: r.object, kind: r.kind, status: r.status,
    category: category(r),
  }));
  const categoryCounts = Object.fromEntries([...new Set(categorized.map(x => x.category))]
    .sort().map(c => [c, categorized.filter(x => x.category === c).length]));
  const preRecoveryCount = pre0128.nonPassing.filter(r => targets.has(r.table)).length;

  return {
    evidence: "SYNTHETIC_CATALOG_DIFF_PROVENANCE_NOT_APPROVAL",
    source: { ...source.counts },
    pre0128: { ...pre0128.counts },
    post0128: { ...post0128.counts },
    sourceBaselineNonPassing: source.nonPassing.length,
    sourceOnly: source.nonPassing.filter(r => !before.has(rowKey(r))).length,
    preCandidateOnly: preNew.length,
    postCandidateOnly: postNew.length,
    candidateOnlyRowsResolvedByStage: preNew.filter(r => !after.has(rowKey(r))).length,
    beforeRecoveryNonPassing: preRecoveryCount,
    afterRecoveryNonPassing: postRecovery.length,
    expected0128Renames: mappings.length,
    verifiedSemanticFkRenames: resolved.length,
    failedRenameChecks: unresolved,
    postRecoveryResidual: sortRows(postRecovery).map(({table,object,kind,status}) =>
      ({table,object,kind,status})),
    postCandidateOnlyByCategory: categoryCounts,
    postCandidateOnlyObjects: categorized,
    catalogReconciliationGate: unresolved.length === 0 && postRecovery.length === 0
      ? "RECOVERY_0128_NAMES_PAIRED_ONLY" : "BLOCKED_RECOVERY_RECONCILIATION",
    fullSchemaParity: "NOT_ESTABLISHED",
    DBAApproval: false,
  };
}

export function summarizeAtlasPlan(sql) {
  if (typeof sql !== "string") throw new TypeError("Atlas plan must be a string");
  const statements = sql.split(/\r?\n/).map(line => line.trim())
    .filter(line => /^(?:ALTER TABLE|DROP INDEX|CREATE INDEX|CREATE TABLE|DROP TABLE|ALTER INDEX)\b/i.test(line));
  const tableHints = statements.map(statement => {
    const match = statement.match(/^(?:ALTER TABLE|DROP TABLE|CREATE TABLE)\s+"?([a-z_]+)"?/i);
    return match ? match[1] : null;
  });
  return {
    atlasSqlStatementCount: statements.length,
    destructiveSuggestionCount: statements.filter(s =>
      /\bDROP\s+(?:COLUMN|INDEX|CONSTRAINT|TABLE)\b/i.test(s)).length,
    touchedTableHints: [...new Set(tableHints.filter(Boolean))].sort(),
    generatedDdlWasExecuted: false,
    requiresIndependentReview: statements.length > 0 || sql.trim() !== "",
  };
}
