/**
 * Conflict-aware tenant GAP batch planner. SOURCE/QUEUE ONLY: zero HTTP, DB,
 * provider, deployment or coverage-credit writes.
 *
 * Uses the existing AST-validated read/write proof catalog, not a guessed
 * regex or an auto-generated "successful" response. An existing proof row
 * remains provisional until real exact-head PG16 HTTP evidence is reviewed.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tenantFamilyCatalog } from "./tenant-table-catalog.mjs";

export const DEFAULT_BATCH_SIZE = 16;
const STATUSES = new Set(["COVERED", "GAP", "PUBLIC-BY-DESIGN"]);
const KINDS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

const PEOPLE = new Set(["hcm", "self", "employees", "performance", "recruitment",
  "leave", "benefits", "compensation", "careers", "invitations"]);
const WORKFORCE = new Set(["workforce", "workforce-planning", "attendance",
  "biometrics"]);
const FINANCIAL = new Set(["payroll-runs", "year-end", "bir", "compliance",
  "spend", "billing", "loans", "expenses", "final-pay", "payouts"]);
const PLATFORM = new Set(["auth", "account", "jobs", "readiness", "setup",
  "webhooks", "multi-entity", "v1", "signup"]);

export function inspectMethod(key) {
  assert.match(key, /^(GET|POST|PUT|PATCH|DELETE) [A-Za-z0-9_\-/\[\].]+$/,
    "invalid canonical manifest method key: " + key);
  const [method, route] = key.split(" ");
  assert.ok(route.split("/").every(segment => segment.length && segment !== "." && segment !== ".."),
    "invalid canonical method path: " + key);
  const family = route.split("/")[0];
  const domain = PEOPLE.has(family) ? "people" : WORKFORCE.has(family)
    ? "workforce" : FINANCIAL.has(family) ? "finance"
    : PLATFORM.has(family) ? "platform" : "other";
  const risk = /(?:payout|disbursement|bank|remittance|settlement|filing|webhook|sso|saml|payment)/i.test(route)
    || FINANCIAL.has(family) ? "critical"
    : ["auth", "account", "multi-entity", "jobs", "self"].includes(family)
      ? "sensitive" : "standard";
  return { key, method, route, family, domain, risk };
}

export function readMethodInventory(manifest) {
  assert.ok(manifest && typeof manifest === "object");
  assert.ok(manifest.allApiRouteFiles &&
    !Array.isArray(manifest.allApiRouteFiles) &&
    typeof manifest.allApiRouteFiles === "object",
  "missing authoritative route-file manifest");
  const seen = new Set(), methods = [];
  for (const [file, route] of Object.entries(manifest.allApiRouteFiles)) {
    assert.match(file, /^src\/app\/api\/.*\/route\.ts$/,
      "unsupported route file " + file);
    assert.ok(route && typeof route.route === "string" &&
      Array.isArray(route.methods) && route.methods.length > 0,
    "missing declared HTTP methods in " + file);
    for (const entry of route.methods) {
      assert.ok(KINDS.has(entry.name), "unexpected verb in " + file);
      assert.ok(STATUSES.has(entry.status), "unexpected coverage status in " + file);
      const info = inspectMethod(entry.name + " " + route.route);
      assert.ok(!seen.has(info.key), "duplicate canonical method " + info.key);
      seen.add(info.key);
      methods.push({ ...info, file, status: entry.status });
    }
  }
  const totals = {
    methods: methods.length,
    covered: methods.filter(x => x.status === "COVERED").length,
    gap: methods.filter(x => x.status === "GAP").length,
    publicByDesign: methods.filter(x => x.status === "PUBLIC-BY-DESIGN").length,
  };
  assert.equal(manifest.metrics?.methods, totals.methods,
    "live metrics total and enumerated route methods disagree");
  assert.equal(manifest.metrics?.coveredAfter, totals.covered,
    "live COVERED metric and enumerated methods disagree");
  assert.equal(manifest.metrics?.gap, totals.gap,
    "live GAP metric and enumerated methods disagree");
  assert.equal(manifest.metrics?.publicByDesign, totals.publicByDesign,
    "live PUBLIC-BY-DESIGN metric and enumerated methods disagree");
  return { methods: methods.sort((a, b) => a.key.localeCompare(b.key)), totals };
}

export function indexExistingProofRows(readRows, writeRows) {
  assert.ok(Array.isArray(readRows) && Array.isArray(writeRows),
    "AST-validated family row lists are required");
  const found = new Map();
  for (const [kind, catalog] of [["read", readRows], ["write", writeRows]]) {
    for (const row of catalog) {
      const info = inspectMethod(row.key);
      assert.equal(info.method === "GET" ? "read" : "write", kind,
        "read/write catalog kind mismatch for " + row.key);
      assert.ok(!found.has(row.key), "two source rows claim " + row.key);
      assert.ok(typeof row.file === "string" &&
        row.file.startsWith("scripts/qa/tenant-table-rows/" + kind + "/"),
      "proof row has an unexpected file source");
      found.set(row.key, {
        file: row.file, profile: row.profile ?? "default",
        flags: row.flags ?? [], sourceLine: row.line ?? null,
      });
    }
  }
  return found;
}

export function validateReservations(reservations, inventory) {
  assert.equal(reservations?.schemaVersion, 1, "unexpected reservation schema");
  assert.ok(Array.isArray(reservations.entries), "reservation entries must be an array");
  const byKey = new Map(), known = new Map(inventory.methods.map(x => [x.key, x]));
  for (const entry of reservations.entries) {
    assert.ok(Number.isSafeInteger(entry.pr) && entry.pr > 0,
      "every reservation must link to a real PR number");
    assert.ok(["open-proof", "merged-proof-uncredited"].includes(entry.state),
      "reservation status must distinguish open and merged uncredited proof");
    assert.ok(Array.isArray(entry.methods) && entry.methods.length > 0,
      "reservation without exact method identities");
    for (const key of entry.methods) {
      assert.ok(known.has(key), "reservation references unknown method " + key);
      assert.equal(known.get(key).status, "GAP",
        "already-credited method must be removed from reservations: " + key);
      assert.ok(!byKey.has(key), "duplicate method reservation: " + key);
      byKey.set(key, {
        pr: entry.pr, state: entry.state,
        reason: "No manifest credit until exact-head PG16 HTTP proof and independent review",
      });
    }
  }
  return byKey;
}

const sorting = (a, b) => a.key.localeCompare(b.key);

function stageFor(method, sources, reservations) {
  if (reservations.has(method.key)) return "reserved-evidence";
  if (sources.has(method.key)) return "existing-row-review";
  return "new-proof";
}

/** Each batch owns unique proposed *new* files, never the global manifest. */
export function buildTenantGapPlan({
  manifest, readRows, writeRows, reservations, maxMethods = DEFAULT_BATCH_SIZE,
}) {
  assert.ok(Number.isInteger(maxMethods) && maxMethods >= 10 && maxMethods <= 25,
    "method batches must be between 10 and 25 max methods");
  const inventory = readMethodInventory(manifest);
  const sources = indexExistingProofRows(readRows, writeRows);
  const reserved = validateReservations(reservations, inventory);
  const inventoryKeys = new Set(inventory.methods.map(x => x.key));
  for (const key of sources.keys()) assert.ok(inventoryKeys.has(key),
    "source-table method not in authoritative manifest: " + key);
  const gaps = inventory.methods.filter(x => x.status === "GAP")
    .map(row => ({
      ...row, stage: stageFor(row, sources, reserved),
      existingProof: sources.get(row.key) ?? null,
      reservation: reserved.get(row.key) ?? null,
    }));
  const groups = new Map();
  for (const row of gaps) {
    if (row.stage === "reserved-evidence") continue;
    // Existing rows use the verified runner/profile; new rows use domain and
    // security tier, so incompatible provider & financial methods are isolated.
    const grouping = row.stage === "existing-row-review"
      ? ["existing", row.existingProof.profile, row.method === "GET" ? "read" : "write"]
      : ["new", row.domain, row.risk];
    const bucket = grouping.join(":");
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket).push(row);
  }

  const batches = [];
  for (const [bucket, records] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    records.sort(sorting);
    for (let start = 0, index = 0; start < records.length; start += maxMethods, index++) {
      const slice = records.slice(start, start + maxMethods);
      const id = "TQ-" + bucket.toUpperCase().replace(/[^A-Z0-9]+/g, "-") +
        "-" + String(index + 1).padStart(2, "0");
      assert.match(id, /^TQ-[A-Z0-9-]+$/);
      const slug = id.toLowerCase();
      const types = [...new Set(slice.map(x => x.method))].sort();
      batches.push({
        id,
        stage: slice[0].stage,
        evidenceAccepted: false,
        coverageCredits: 0,
        methodCount: slice.length,
        methods: slice.map(x => x.key),
        httpVerbs: types,
        riskTiers: [...new Set(slice.map(x => x.risk))].sort(),
        domains: [...new Set(slice.map(x => x.domain))].sort(),
        existingProofFiles: [...new Set(slice.map(x => x.existingProof?.file).filter(Boolean))].sort(),
        proposedExclusiveFiles: [
          "scripts/qa/tenant-batches/" + slug + ".mjs",
          "tests/tenant-batches/" + slug + ".test.mjs",
        ],
      });
    }
  }
  const allBatched = batches.flatMap(b => b.methods);
  assert.equal(allBatched.length + reserved.size, gaps.length,
    "every remaining GAP must belong to exactly one bucket or reservation");
  assert.equal(new Set(allBatched).size, allBatched.length,
    "method assigned to multiple batches");
  assert.ok(allBatched.every(k => !reserved.has(k)),
    "reserved method reused by a new work lane");
  const proposedPaths = batches.flatMap(b => b.proposedExclusiveFiles);
  assert.equal(new Set(proposedPaths).size, proposedPaths.length,
    "batch proposals overlap on test filenames");
  const counts = {
    reservedEvidence: gaps.filter(x => x.stage === "reserved-evidence").length,
    existingRowsToReverify: gaps.filter(x => x.stage === "existing-row-review").length,
    methodsNeedingNewProof: gaps.filter(x => x.stage === "new-proof").length,
  };
  assert.equal(Object.values(counts).reduce((n, x) => n + x, 0),
    inventory.totals.gap);
  return {
    kind: "tenant-gap-method-batch-queue",
    generatedFrom: "live authoritative coverage manifest + AST source catalog",
    coverageCredits: 0,
    accepted: false,
    maxMethods,
    totals: inventory.totals,
    counts,
    gaps,
    batches,
    reserved: [...reserved].map(([method, claim]) => ({ method, ...claim })),
  };
}

export function scaffoldBatch(batch) {
  assert.ok(batch && batch.stage === "new-proof" &&
    Array.isArray(batch.methods) && batch.methods.length,
  "only a new-proof batch can produce a new proof scaffold");
  const methods = JSON.stringify(batch.methods, null, 2);
  const declarations = batch.methods.map((key, index) =>
    "  async () => { throw new Error(" +
    JSON.stringify("UNIMPLEMENTED_REAL_HTTP_PG16_PROOF " + key) + "); },"
  ).join("\n");
  return `/** GENERATED UNVERIFIED SCAFFOLD — no coverage credit or acceptance.
 * Implement actual owned-object positives and genuine persisted victim denials
 * using a disposable PG16/localhost harness. Never replace throws with stubs.
 * Method identities: ${batch.id}. Keep payroll, providers and live data OFF.
 */
export const METHODS = Object.freeze(${methods});
const PROOFS = [
${declarations}
];
export async function verifyBatch({ requireDisposable }) {
  if (typeof requireDisposable !== "function") throw Error("MISSING_DISPOSABLE_GUARD");
  requireDisposable();
  if (METHODS.length !== PROOFS.length) throw Error("PROOF_COUNT_MISMATCH");
  for (const prove of PROOFS) await prove();
}
`;
}

export function renderSummary(plan) {
  const t = plan.totals, c = plan.counts;
  const lines = [
    "# Tenant GAP batch queue (planning only; no credits)",
    "",
    "Covered: " + t.covered + " / " + t.methods +
      " | GAP: " + t.gap + " | Public-by-design: " + t.publicByDesign,
    "Reserved proof: " + c.reservedEvidence + " | Existing source rows awaiting review: " +
      c.existingRowsToReverify + " | Need new source proof: " + c.methodsNeedingNewProof,
    "Uncredited proposed batches: " + plan.batches.length +
      " (target max " + plan.maxMethods + " methods; smaller incompatible tails retained)",
    "",
    "| Proposed batch | Methods | Stage | Domains | Risk |",
    "|---|---:|---|---|---|",
    ...plan.batches.map(b => "| " + b.id + " | " + b.methodCount +
      " | " + b.stage + " | " + b.domains.join(", ") +
      " | " + b.riskTiers.join(", ") + " |"),
    "",
    "No source-line or CI status implies tenant-coverage acceptance. Only real exact-head HTTP/PG16 evidence and independent manifest review can do so.",
  ];
  return lines.join("\n") + "\n";
}

export function loadLivePlan(maxMethods = DEFAULT_BATCH_SIZE) {
  const manifest = JSON.parse(readFileSync(
    "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const reservations = JSON.parse(readFileSync(
    "scripts/qa/tenant-gap-reservations.json", "utf8"));
  return buildTenantGapPlan({
    manifest, reservations,
    readRows: tenantFamilyCatalog("read"),
    writeRows: tenantFamilyCatalog("write"),
    maxMethods,
  });
}

function main(args) {
  if (args.includes("--help")) {
    process.stdout.write("node scripts/qa/tenant-gap-factory.mjs [--summary|--json|--scaffold BATCH-ID] [--max N (10..25)]\n");
    return;
  }
  let maxMethods = DEFAULT_BATCH_SIZE;
  const ix = args.indexOf("--max");
  if (ix >= 0) {
    assert.ok(/^\d+$/.test(args[ix + 1] ?? ""), "--max requires an integer");
    maxMethods = Number(args[ix + 1]);
    args.splice(ix, 2);
  }
  const plan = loadLivePlan(maxMethods);
  if (args.length === 0 || (args.length === 1 && args[0] === "--summary")) {
    process.stdout.write(renderSummary(plan));
  } else if (args.length === 1 && args[0] === "--json") {
    process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
  } else if (args.length === 2 && args[0] === "--scaffold") {
    const batch = plan.batches.find(x => x.id === args[1]);
    assert.ok(batch, "unknown batch ID");
    process.stdout.write(scaffoldBatch(batch));
  } else {
    throw new Error("Unsupported options. Use --help");
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/tenant-gap-factory.mjs")) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(String(error.message)); process.exitCode = 1; }
}
