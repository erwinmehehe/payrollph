/**
 * DL-01 whole-batch closure: one CI receipt covers ALL five outstanding
 * manifest method identities, NEVER a sub-slice. Existing 19 provisional
 * COVERED and 2 PUBLIC-BY-DESIGN entries retain their reviewed provenance.
 */
import assert from "node:assert/strict";
import { fixture, METHODS, victimSnapshot } from "./tenant-dl01-closure-shared.mjs";
import * as prior from "./tenant-dl01-rows/prior-evidence.mjs";
import * as documents from "./tenant-dl01-rows/documents.mjs";
import * as imports from "./tenant-dl01-rows/employee-import.mjs";
import * as payout from "./tenant-dl01-rows/payout-export.mjs";

const described = [...prior.METHODS, ...documents.METHODS, ...imports.METHODS, ...payout.METHODS];
assert.equal(new Set(described).size, 5, "DL-01 family method identity must be unique");
assert.deepEqual([...described].sort(), [...METHODS].sort(),
  "All five exact closure-plan methods must be in this ONE batch proof");

export async function verifyDl01WholeBatch() {
  const ctx = await fixture();
  try {
    // Seed real row-level victim evidence AFTER the equivalent attacker
    // fixtures, so every method has an actual high-ID exclusive victim.
    for (const family of [prior, documents, imports, payout]) {
      await family.prepare(ctx);
    }
    const untouched = await victimSnapshot(ctx.victim);
    const passed = [];
    for (const family of [prior, documents, imports, payout]) {
      await family.verify(ctx);
      assert.deepEqual(await victimSnapshot(ctx.victim), untouched,
        family.METHODS.join(", ") + ": victim business, PII and audit unchanged");
      passed.push(...family.METHODS);
      console.log(JSON.stringify({
        kind: "DL01_METHOD_FAMILY_PASS", methods: family.METHODS,
        attackerEmployers: 2, realVictim: true, victimDatabaseUnchanged: true,
        productionTested: false, moneyMoved: false,
      }));
    }
    assert.deepEqual([...passed].sort(), [...METHODS].sort());
    const report = {
      kind: "DL01_WHOLE_BATCH_REAL_HTTP_PG16_PASS",
      batchId: "DL-01", allFiveMethods: passed,
      methodCount: 5, signedInAttackerEmployers: 2,
      victimOwnedRowsPersistedAndHigherIds: true,
      legitimateOwnPositive: true, realVictimDenied: true,
      forgedSelectorChecked: true, victimDatabaseUnchanged: true,
      mockedPaymongoUrlNeverReached: true, mockPayoutOnly: true,
      syntheticHttpsScanner: true, ephemeralStorageReadback: true,
      productionTested: false, productionFlagsActivated: false,
      certification: "PROVISIONAL ONLY - independent security review still required",
    };
    console.log(JSON.stringify(report));
    return report;
  } finally {
    await ctx.pool.end();
  }
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/tenant-dl01-closure-http.mjs")) {
  verifyDl01WholeBatch().then(() => process.exit(0), err => {
    console.error(err); process.exit(1);
  });
}
