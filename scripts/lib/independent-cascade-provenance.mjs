/**
 * Immutable, catalog-only witness for collateral FK removal by the synthetic
 * DROP TABLE ... CASCADE setup. Never repairs FKs or waives source/model drift.
 */
const key = row => JSON.stringify([row.childTable, row.constraintName]);
function verify(rows, label) {
  if (!Array.isArray(rows)) throw new Error(label + " is not a catalog row array");
  const seen = new Set();
  for (const row of rows) {
    if (!row || !["childTable", "referencedTable", "constraintName", "definition"]
      .every(field => typeof row[field] === "string" && row[field].length > 0))
      throw new Error(label + " has invalid catalog evidence");
    const identity = key(row);
    if (seen.has(identity)) throw new Error(label + " has duplicate FK identity");
    seen.add(identity);
  }
  return new Map(rows.map(row => [key(row), row]));
}

export function classifySyntheticCascade(before, immediatelyAfterDrop, afterReplay) {
  const original = verify(before, "original");
  const dropped = verify(immediatelyAfterDrop, "post-drop");
  const replayed = verify(afterReplay, "post-replay");
  const result = [];
  for (const [identity, row] of original) {
    if (dropped.has(identity)) {
      throw new Error("DROP CASCADE did not remove original foreign key: " + identity);
    }
    const replacement = replayed.get(identity);
    result.push({
      ...row,
      status: !replacement
        ? "REMOVED_BY_SYNTHETIC_CASCADE_NOT_RESTORED_BY_SOURCE_NAME"
        : replacement.definition === row.definition &&
            replacement.referencedTable === row.referencedTable
          ? "RESTORED_WITH_IDENTICAL_NAME_AND_DEFINITION"
          : "NAME_REUSED_WITH_DIFFERENT_CONTRACT_REVIEW",
    });
  }
  result.sort((a, b) => key(a).localeCompare(key(b)));
  return {
    evidence: "FRESH_DRIZZLE_CLONE_SYNTHETIC_CASCADE_ONLY",
    originalCollateralForeignKeys: result.length,
    stillAbsentByNameAfterReplay: result.filter(r =>
      r.status === "REMOVED_BY_SYNTHETIC_CASCADE_NOT_RESTORED_BY_SOURCE_NAME").length,
    foreignKeys: result,
    status: "EVIDENCE_ONLY_NOT_A_WAIVER",
    originalMigrationEdited: false,
    productionParityEstablished: false,
  };
}

export function corroborateCascadeResiduals(candidateRows, trace) {
  if (!Array.isArray(candidateRows) || !trace ||
      trace.evidence !== "FRESH_DRIZZLE_CLONE_SYNTHETIC_CASCADE_ONLY" ||
      !Array.isArray(trace.foreignKeys))
    throw new Error("Missing valid synthetic cascade evidence");
  const identities = new Set(trace.foreignKeys
    .filter(row => row.status ===
      "REMOVED_BY_SYNTHETIC_CASCADE_NOT_RESTORED_BY_SOURCE_NAME")
    .map(key));
  const possible = candidateRows.filter(row =>
    row.category === "POSSIBLE_SYNTHETIC_DROP_CASCADE_FK_LOSS_REVIEW");
  const unsupported = possible.filter(row => !identities.has(JSON.stringify([
    row.table, row.object,
  ])));
  return {
    possibleFixtureCascadeResiduals: possible.length,
    witnessedSourceCloneDrop: possible.length - unsupported.length,
    stillUnresolved: possible.length,
    unsupported: unsupported.map(row => ({
      table: row.table, object: row.object, status: row.status,
    })),
    disposition: unsupported.length === 0
      ? "CASCADE_PROVEN_IN_SYNTHETIC_CLONE_ONLY_NOT_PRODUCTION_PARITY"
      : "UNPROVEN_CASCADE_CAUSALITY_BLOCK",
    sourceOnly: true,
    waiverCount: 0,
  };
}
