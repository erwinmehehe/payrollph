import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildTenantGapPlan, inspectMethod, indexExistingProofRows,
  loadLivePlan, readMethodInventory, renderSummary, scaffoldBatch,
} from "../scripts/qa/tenant-gap-factory.mjs";

const one = (route, methods) => [
  "src/app/api/" + route + "/route.ts",
  { route, methods: methods.map(([name, status]) => ({ name, status })) },
];
function sample() {
  return {
    metrics: { methods: 5, coveredAfter: 1, gap: 3, publicByDesign: 1 },
    allApiRouteFiles: Object.fromEntries([
      one("self/availability", [["GET", "GAP"], ["POST", "GAP"]]),
      one("hcm/events", [["GET", "GAP"]]),
      one("health", [["GET", "PUBLIC-BY-DESIGN"]]),
      one("hcm/known", [["POST", "COVERED"]]),
    ]),
  };
}
const rows = [{
  key: "GET hcm/events", profile: "default", flags: [],
  file: "scripts/qa/tenant-table-rows/read/fictional.mjs", line: 1,
}];
const claims = { schemaVersion: 1, entries: [{
  pr: 1455, state: "merged-proof-uncredited",
  methods: ["GET self/availability", "POST self/availability"],
}] };

test("batch factory reads manifest methods exactly, excluding both non-GAP statuses", () => {
  const inv = readMethodInventory(sample());
  assert.deepEqual(inv.totals, { methods: 5, covered: 1, gap: 3, publicByDesign: 1 });
  assert.equal(inv.methods.filter(x => x.status === "GAP").length, 3);
  assert.equal(inspectMethod("GET hcm/events").domain, "people");
  assert.equal(inspectMethod("POST payroll-runs/[id]/release").risk, "critical");
  assert.throws(() => inspectMethod("GET ../../prod"), /invalid canonical/);
});

test("existing proof is only a review candidate, and merged evidence does not auto-credit", () => {
  const plan = buildTenantGapPlan({
    manifest: sample(), readRows: rows, writeRows: [],
    reservations: claims, maxMethods: 10,
  });
  assert.equal(plan.coverageCredits, 0);
  assert.equal(plan.accepted, false);
  assert.deepEqual(plan.counts, {
    reservedEvidence: 2, existingRowsToReverify: 1, methodsNeedingNewProof: 0,
  });
  assert.deepEqual(plan.batches.flatMap(x => x.methods), ["GET hcm/events"]);
  assert.equal(plan.batches[0].existingProofFiles[0], rows[0].file);
  assert.equal(plan.batches[0].evidenceAccepted, false);
  assert.equal(plan.batches[0].coverageCredits, 0);
  assert.deepEqual(plan.reserved.map(x => x.method).sort(),
    ["GET self/availability", "POST self/availability"]);
  assert.doesNotMatch(renderSummary(plan), /proven accepted/i);
});

test("new-proof scaffold fails closed and does not manufacture an HTTP/PG16 result", () => {
  const m = sample();
  m.allApiRouteFiles["src/app/api/hcm/events/route.ts"].methods[0].status = "GAP";
  const plan = buildTenantGapPlan({
    manifest: m, readRows: [], writeRows: [],
    reservations: claims, maxMethods: 10,
  });
  const batch = plan.batches.find(x => x.stage === "new-proof");
  assert.ok(batch);
  const source = scaffoldBatch(batch);
  assert.match(source, /UNIMPLEMENTED_REAL_HTTP_PG16_PROOF/);
  assert.match(source, /requireDisposable\(\)/);
  assert.match(source, /METHODS\.length !== PROOFS\.length/);
  assert.doesNotMatch(source, /status:\s*200|accepted:\s*true|coverageCredits:\s*[1-9]/);
  assert.throws(() => scaffoldBatch({ stage: "existing-row-review", methods: ["GET hcm/events"] }),
    /only a new-proof batch/);
});

test("factory refuses duplicate method claims, unknown methods, fake credit and stale source", () => {
  assert.throws(() => readMethodInventory({
    ...sample(), allApiRouteFiles: {
      ...sample().allApiRouteFiles,
      "src/app/api/hcm/second/route.ts": {
        route: "hcm/events", methods: [{ name: "GET", status: "GAP" }],
      },
    },
  }), /duplicate canonical method/);
  assert.throws(() => buildTenantGapPlan({
    manifest: sample(), readRows: rows.concat(rows), writeRows: [],
    reservations: claims, maxMethods: 10,
  }), /two source rows claim/);
  assert.throws(() => buildTenantGapPlan({
    manifest: sample(), readRows: [{
      key: "GET missing", file: "scripts/qa/tenant-table-rows/read/missing.mjs",
    }], writeRows: [], reservations: claims, maxMethods: 10,
  }), /source-table method not in authoritative manifest/);
  assert.throws(() => buildTenantGapPlan({
    manifest: sample(), readRows: rows, writeRows: [],
    reservations: { schemaVersion: 1, entries: claims.entries.concat(claims.entries) },
    maxMethods: 10,
  }), /duplicate method reservation/);
  assert.throws(() => buildTenantGapPlan({
    manifest: sample(), readRows: rows, writeRows: [],
    reservations: { schemaVersion: 1, entries: [{
      pr: 22, state: "open-proof", methods: ["POST hcm/known"],
    }] }, maxMethods: 10,
  }), /already-credited/);
  assert.throws(() => buildTenantGapPlan({
    manifest: sample(), readRows: rows, writeRows: [],
    reservations: claims, maxMethods: 26,
  }), /between 10 and 25/);
});

test("live 2026 queue stays method-complete, disjoint, reproducible and uncredited", () => {
  const first = loadLivePlan(16), second = loadLivePlan(16);
  const manifest = JSON.parse(readFileSync(
    "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  assert.deepEqual(first.totals, readMethodInventory(manifest).totals);
  assert.deepEqual(first.counts, second.counts);
  assert.deepEqual(first.batches, second.batches);
  assert.equal(first.coverageCredits, 0);
  assert.equal(first.accepted, false);
  assert.equal(first.totals.gap, first.gaps.length);
  const keys = first.batches.flatMap(x => x.methods)
    .concat(first.reserved.map(x => x.method));
  assert.equal(keys.length, first.totals.gap);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(first.gaps.every(x => x.status === "GAP"));
  assert.ok(first.batches.every(x => x.methodCount <= 16 &&
    x.coverageCredits === 0 && x.evidenceAccepted === false));
  const paths = first.batches.flatMap(x => x.proposedExclusiveFiles);
  assert.equal(new Set(paths).size, paths.length);
  // The planner must not propose edits to PR-hot global proof files.
  assert.ok(paths.every(x =>
    !x.includes("tenant-isolation-coverage-manifest.json") &&
    !x.includes("tenant-table-http.mjs") &&
    !x.includes("tenant-table-credit.mjs") &&
    !x.includes("tenant-isolation-coverage-inventory.md")));
});
