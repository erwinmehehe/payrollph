import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { tenantFamilyCatalog } from "./tenant-table-catalog.mjs";
import { METHODS as developmentMethods, verifyCredit as verifyDevelopmentCredit } from "./tenant-performance-development-actions.mjs";

export const RECONCILIATION_FILE = "scripts/qa/tenant-merged-family-reconciliation.json";
export const RECONCILED_METHODS = Object.freeze(["POST performance/calibration", "GET enterprise", "PUT organizations"]);

/** Reviewed receipts reference actual CI, not an executor or global certification. */
export function reviewedFamilySelection(receipt = JSON.parse(readFileSync(RECONCILIATION_FILE, "utf8")), read = file => readFileSync(file, "utf8")) {
  assert.equal(receipt.schema, "reviewed-merged-family-reconciliation-v1");
  assert.equal(receipt.reviewedHead, "c8de88438c358a42b9aef53c1300c95b23ceef81");
  assert.equal(receipt.run, "https://github.com/erwinmehehe/payrollph/actions/runs/40251255765");
  assert.deepEqual(receipt.profiles, { default: { job: 121343443572, conclusion: "success" },
    "multi-entity": { job: 121343443894, conclusion: "success" }, "flagged-reads": { job: 121343443897, conclusion: "success" } });
  assert.deepEqual(receipt.defaultSummary, { reads: 77, readPairs: 154, readDiscriminating: 77, writes: 35,
    writePairs: 70, writeDiscriminating: 35, forgedReferenceProofs: 42, victimDatabaseUnchanged: true, productionTested: false, certified: false });
  assert.equal(Object.keys(receipt.sources).length, 6);
  for (const [file, digest] of Object.entries(receipt.sources)) {
    assert.equal(createHash("sha256").update(read(file).replaceAll("\r\n", "\n")).digest("hex"), digest,
      file + ": changed proof/route requires renewed review and evidence");
  }
  assert.deepEqual(receipt.accepted.map(row => row.key).sort(), [...RECONCILED_METHODS].sort(), "only three reviewed methods qualify");
  assert.equal(createHash("sha256").update(JSON.stringify(receipt.accepted)).digest("hex"),
    "0c4ea597ff7eed88b9c2049f75220cdf078d7d7842315e196111ce941d0900f9", "accepted scopes require renewed review");
  const catalog = [...tenantFamilyCatalog("read"), ...tenantFamilyCatalog("write")];
  const targetRows = catalog.filter(row => /\/(?:performance-growth|platform-controls)\.mjs$/.test(row.file));
  const held = receipt.held.map(row => row.key);
  assert.equal(new Set(held).size, 11); assert.equal(held.length, 11);
  assert.deepEqual([...held, ...RECONCILED_METHODS].sort(), targetRows.map(row => row.key).sort(), "all fourteen methods must be accounted for once");
  for (const item of [...receipt.accepted, ...receipt.held]) assert.ok((item.scope ?? item.reason)?.length > 30);
  for (const key of RECONCILED_METHODS) {
    const row = catalog.find(row => row.key === key); assert.equal(row.profile, "default");
    assert.ok(Object.hasOwn(receipt.sources, row.file));
    assert.ok(Object.hasOwn(receipt.sources, "src/app/api/" + key.split(" ")[1] + "/route.ts"));
  }
  return { receipt, methods: new Map(receipt.accepted.map(row => [row.key, row])) };
}

export function verifyReconciledFamilyCredits(manifest, read) {
  const { receipt, methods } = reviewedFamilySelection(undefined, read);
  for (const [key, selected] of methods) {
    const [verb, route] = key.split(" ");
    const method = manifest.allApiRouteFiles["src/app/api/" + route + "/route.ts"].methods.find(method => method.name === verb);
    assert.equal(method.status, "COVERED", key); assert.equal(method.testedBy.reviewedHead, receipt.reviewedHead);
    assert.equal(method.testedBy.passedJob, receipt.run + "/job/" + receipt.profiles.default.job);
    assert.equal(method.testedBy.scope, selected.scope);
  }
  for (const { key } of receipt.held) {
    const [verb, route] = key.split(" ");
    const method = manifest.allApiRouteFiles["src/app/api/" + route + "/route.ts"].methods.find(method => method.name === verb);
    if (method.status === "COVERED" && developmentMethods.includes(key)) verifyDevelopmentCredit(key, method, read);
    else assert.equal(method.status, "GAP", key + ": partial action is not full method credit");
  }
  return methods.size;
}
