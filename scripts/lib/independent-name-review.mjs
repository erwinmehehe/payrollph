import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";

/**
 * Strict REVIEW-ONLY FK-name experiment. Inputs come from two independent
 * catalog snapshots, not heuristics or executable production migration SQL.
 * No DDL, networking, waivers or database access occurs in this module.
 */
const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;
const signature = row => JSON.stringify([
  row.table, row.object, row.kind, row.status, row.expected, row.actual,
]);
const nameOf = row => JSON.stringify([row.table, row.object]);

export function checkedSyntheticNamePairs(report, headSha, expectedCount = 54) {
  assert.equal(typeof headSha, "string");
  assert.ok(/^[0-9a-f]{40}$/.test(headSha), "Exact PR head SHA required");
  assert.equal(report?.prHeadSha, headSha, "Catalog report is from another PR head");
  assert.equal(report?.reconciliation?.catalogReconciliationGate,
    "RECOVERY_0128_NAMES_PAIRED_ONLY", "0128 synthetic stage not proven");
  assert.equal(report?.reconciliation?.verifiedSemanticFkRenames, 49);
  assert.deepEqual(report?.reconciliation?.failedRenameChecks, []);
  const pairs = report?.reconciliation?.nameOnlyFkPairsOutside0128;
  assert.ok(Array.isArray(pairs), "Missing unapproved name-pair inventory");
  assert.equal(pairs.length, expectedCount, "Unexpected scope of FK-name differences");
  const rows = report?.reconciled?.nonPassing;
  assert.ok(Array.isArray(rows), "Missing reconciled read-only catalog");
  const keys = new Set();
  const renamed = pairs.map(pair => {
    assert.equal(pair.foreignKeyDefinitionMatched, true);
    assert.equal(pair.individuallyApprovedForMigration, false);
    for (const item of [pair.table, pair.observedName, pair.expectedName]) {
      assert.ok(typeof item === "string" && IDENTIFIER.test(item),
        "Unsafe or truncated PostgreSQL identifier");
    }
    assert.notEqual(pair.observedName, pair.expectedName);
    const oldKey = JSON.stringify([pair.table, pair.observedName]);
    const newKey = JSON.stringify([pair.table, pair.expectedName]);
    assert.ok(!keys.has(oldKey) && !keys.has(newKey), "Duplicate/overlapping FK rename");
    keys.add(oldKey);
    keys.add(newKey);
    const missing = rows.filter(row => row.table === pair.table &&
      row.object === pair.expectedName && row.kind === "foreign_key" &&
      row.status === "MISSING");
    const extra = rows.filter(row => row.table === pair.table &&
      row.object === pair.observedName && row.kind === "foreign_key" &&
      row.status === "EXTRA");
    assert.equal(missing.length, 1, "Expected modeled FK missing from candidate");
    assert.equal(extra.length, 1, "Unrecognized candidate FK name");
    assert.ok(isDeepStrictEqual(missing[0].expected, extra[0].actual),
      "FK contract differs; name-only rename is unsafe");
    assert.equal(missing[0].expected.validated, true,
      "Unvalidated historical FK cannot be auto-renamed");
    return {
      table: pair.table, from: pair.observedName, to: pair.expectedName,
      contract: missing[0].expected,
    };
  });
  renamed.sort((a,b) => nameOf({table:a.table,object:a.from})
    .localeCompare(nameOf({table:b.table,object:b.from})));
  return renamed;
}

export function syntheticRenameStatements(pairs) {
  if (!Array.isArray(pairs) || pairs.length !== 54)
    throw new Error("Exactly 54 verified FK-name differences required");
  return pairs.map(pair => {
    if (![pair.table, pair.from, pair.to].every(x =>
        typeof x === "string" && IDENTIFIER.test(x)))
      throw new Error("Unsafe FK rename identifier");
    return 'ALTER TABLE public."' + pair.table + '" RENAME CONSTRAINT "' +
      pair.from + '" TO "' + pair.to + '";';
  });
}

export function verifySyntheticNamePreview(before, after, pairs) {
  const statuses = ["PASS", "MISSING", "DRIFT", "EXTRA"];
  assert.ok(before && after && Array.isArray(before.rows) &&
    Array.isArray(after.rows), "Missing full #1031 before/after records");
  for (const stage of [before, after]) {
    for (const kind of statuses)
      assert.ok(Number.isInteger(stage.counts?.[kind]) && stage.counts[kind]>=0,
        "Invalid #1031 status count " + kind);
    for (const kind of statuses)
      assert.equal(stage.rows.filter(row => row.status === kind).length,
        stage.counts[kind], "Truncated #1031 preview comparison: " + kind);
  }
  assert.equal(pairs.length, 54, "Synthetic name-only cohort changed");
  const beforeNonPass = new Set(before.rows.filter(x=>x.status!=="PASS").map(signature));
  const afterNonPass = new Set(after.rows.filter(x=>x.status!=="PASS").map(signature));
  const removed = new Set();
  for (const pair of pairs) {
    const missing = before.rows.find(x => x.table===pair.table &&
      x.object===pair.to && x.status==="MISSING" && x.kind==="foreign_key");
    const extra = before.rows.find(x => x.table===pair.table &&
      x.object===pair.from && x.status==="EXTRA" && x.kind==="foreign_key");
    assert.ok(missing && extra && isDeepStrictEqual(missing.expected,extra.actual),
      "Bad preview baseline");
    removed.add(signature(missing)); removed.add(signature(extra));
    assert.equal(after.rows.some(x=>x.table===pair.table && x.object===pair.to &&
      x.kind==="foreign_key" && x.status==="PASS"),true,
      "Modeled FK did not become a PASS");
    assert.equal(after.rows.some(x=>x.table===pair.table && x.object===pair.from &&
      x.kind==="foreign_key"),false,"Old FK still visible after rename");
  }
  assert.equal(removed.size,108,"Duplicate comparison evidence");
  const expectedNonPass = [...beforeNonPass].filter(x=>!removed.has(x)).sort();
  assert.deepEqual([...afterNonPass].sort(),expectedNonPass,
    "An unrelated drift was changed or omitted by synthetic rename");
  assert.deepEqual(after.counts,{
    PASS:before.counts.PASS+54, MISSING:before.counts.MISSING-54,
    DRIFT:before.counts.DRIFT, EXTRA:before.counts.EXTRA-54,
  });
  return {
    exactNameOnlyRenames:54, candidateOnlyCatalogRowsDischargedInSimulation:108,
    allOtherDiscrepanciesPreserved:true, physicalConstraintSemanticsChanged:false,
    evidence:"FOURTH_LOCAL_PG16_CLONE_REVIEW_ONLY_NOT_A_MIGRATION",
    sourceMigrationEdited:false, productionParityEstablished:false,
    dbaApproved:false,
  };
}
