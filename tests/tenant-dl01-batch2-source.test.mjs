/**
 * Source-only fail-closed wiring test. Never substitutes for the real HTTP/PG16
 * three-employer run; a method remains GAP until linked to completed proof.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const path = "scripts/qa/tenant-dl01-batch2-http.mjs";
const src = readFileSync(path, "utf8");
const harness = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const keys = [
  ["POST", "compliance/statutory-remittances/posting-import"],
  ["GET", "compliance/contribution-issues/evidence"],
  ["GET", "compliance/labor-inspection/evidence-pack"],
  ["GET", "bi-exports"],
];

test("live three-employer harness invokes every candidate from isolated PostgreSQL only", () => {
  assert.equal(harness.split('verifyDl01Batch2(f, { request, expectStatus })').length - 1, 1);
  assert.ok(src.includes('assert.equal(process.env.CI, "true")'));
  assert.ok(src.includes('assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only")'));
  assert.ok(src.includes('assert.equal(app.href, "http://127.0.0.1:3000/")'));
  assert.ok(src.includes('assert.equal(pg.pathname, "/app_db")'));
  assert.ok(src.includes('for (const idx of [1, 2])'));
  assert.ok(src.includes('assert.equal(account.json?.profile?.id, f.owners[idx].id)'));
  assert.ok(src.includes('const before = await victimSnapshot(victimOrg.id)'));
  assert.ok(src.includes('const after = await victimSnapshot(victimOrg.id)'));
  assert.ok(src.includes('assert.deepEqual(after, before,'));
  assert.ok(src.includes('assert.equal(receipts.length, 2'));
  assert.ok(src.includes('accepted: false, actualFundsMoved: false'));
});

test("posting mutation must apply real own batch and prove real victim denial/unchanged snapshot", () => {
  for (const fragment of [
    'const ownPosting = expectStatus(await request(',
    '}), 200, "DL-01 posting-import own valid CSV POST must APPLY")',
    'assert.equal(ownPosting.json?.applied, true)',
    'assert.equal(posted?.postingStatus, "confirmed")',
    'assert.equal(artifact?.outcome, "applied")',
    'const foreignPosting = expectStatus(await request(',
    '}), 403, "DL-01 real victim employer posting-import POST explicitly denied")',
    'const forgedPosting = expectStatus(await request(',
    '}), 404, "DL-01 real victim batch under attacker\'s authorized employer must be 404")',
    'assert.equal(persistedVictimBatch?.organizationId, victimOrg.id)',
    'assert.equal(persistedVictimMember?.organizationId, victimOrg.id)',
    'assert.equal(persistedVictimCase?.organizationId, victimOrg.id)',
    'assert.ok(victimBatch.id > batches[idx].id',
  ]) assert.ok(src.includes(fragment), "Missing required real mutation proof: " + fragment);
});

test("each download method has own content, victim denial and a forged selector", () => {
  for (const field of ["Export","Bi","Case","Inspection"]) {
    assert.ok(src.includes("const own" + field + " = expectStatus(await request("), field + " missing own request");
    assert.ok(src.includes("const foreign" + field + " = expectStatus(await request("), field + " missing victim denial");
    assert.ok(src.includes("const forged" + field + " = expectStatus(await request("), field + " missing forged selector");
  }
  assert.ok(src.includes('assert.ok(ownExport.text.includes(worker.employeeNo)'));
  assert.ok(src.includes('ownBi.text.includes("ATTACKER-")'));
  assert.ok(src.includes('ownCase.json?.timeline?.length >= 1'));
  assert.ok(src.includes('ownInspection.json.sections.workerRoster.rows.some(row => row.employeeNo === worker.employeeNo)'));
  assert.ok(src.includes('const wrongScopedCase = expectStatus(await request('));
});

test("BI and labor download use existing HIGHER-ID victim-only DB records", () => {
  for (const fragment of [
    'const [victimExportWorker] = await db.insert(employees).values({',
    'const [victimBiRun] = await db.insert(payrollRuns).values({',
    'assert.equal(persistedVictimWorker?.organizationId, victimOrg.id)',
    'assert.equal(persistedVictimBiRun?.organizationId, victimOrg.id)',
    'assert.ok(victimExportWorker.id > f.ownedEmployees[0].id',
    'victimExportWorker.id > f.ownedEmployees[1].id && victimExportWorker.id > 6',
    'assert.ok(victimBiRun.id > f.ownRuns[1].id',
    'victimBiRun.id > f.ownRuns[2].id && victimBiRun.id > 6',
    'assert.ok(fixture.victimExportWorker.id > worker.id)',
    'assert.ok(fixture.victimBiRun.id > f.ownRuns[idx].id)',
    'assert.ok(!ownBi.text.includes(fixture.victimBiRun.periodLabel))',
    'assert.ok(!ownInspection.text.includes(fixture.victimExportWorker.employeeNo))',
    'db.select().from(employees).where(filter(employees)).orderBy(employees.id)',
  ]) assert.ok(src.includes(fragment), "Real higher-ID victim-only export proof missing: " + fragment);
});

function overviewHasLink(route, method, line) {
  const inventory = readFileSync("docs/engineering/tenant-isolation-coverage-inventory.md", "utf8");
  const row = inventory.split("\n").find(value => value.startsWith("| [`" + route + "` " + method + "]"));
  return Boolean(row && row.includes("tenant-dl01-batch2-http.mjs#L" + line) && row.endsWith("**COVERED** |"));
}

test("four newly credited DL-01 methods have independently reviewable real HTTP/PG16 proof pins", () => {
  const lines = src.split("\n");
  const specs = [
    { method: "POST", route: "compliance/statutory-remittances/posting-import", refs: [19, 188, 217, 226, 315, 142, 146], names: ["ownPosting", "foreignPosting", "forgedPosting"], exists: "persistedVictimBatch", order: "victimBatch.id > batches[idx].id", forgedStatus: 404 },
    { method: "GET", route: "compliance/contribution-issues/evidence", refs: [20, 269, 279, 283, 315, 144, 146], names: ["ownCase", "foreignCase", "forgedCase"], exists: "persistedVictimCase", order: "victimCase.id > cases[idx].id", forgedStatus: 200 },
    { method: "GET", route: "compliance/labor-inspection/evidence-pack", refs: [21, 294, 303, 306, 315, 125, 127], names: ["ownInspection", "foreignInspection", "forgedInspection"], exists: "persistedVictimWorker", order: "victimExportWorker.id > f.ownedEmployees[0].id", forgedStatus: 200 },
    { method: "GET", route: "bi-exports", refs: [23, 254, 260, 264, 315, 126, 130], names: ["ownBi", "foreignBi", "forgedBi"], exists: "persistedVictimBiRun", order: "victimBiRun.id > f.ownRuns[1].id", forgedStatus: 400 },
  ];
  for (const spec of specs) {
    const method = manifest.allApiRouteFiles["src/app/api/" + spec.route + "/route.ts"]
      ?.methods.find(x => x.name === spec.method);
    assert.equal(method?.status, "COVERED", spec.route + ": missing reviewed method classification");
    const proof = method.testedBy;
    assert.equal(proof?.file, path, spec.route + ": cannot borrow another proof module");
    assert.deepEqual([
      proof.line, proof.ownPositiveLine, proof.foreignDenialLine, proof.forgedSelectorLine,
      proof.unchangedDbLine, proof.victimExistsLine, proof.victimIdOrderingLine,
    ], spec.refs, spec.route + ": source pins changed without real renewed method review");
    assert.ok(lines[proof.line - 1].includes(spec.method + " " + spec.route));
    for (const [field, name] of [
      ["ownPositiveLine", spec.names[0]],
      ["foreignDenialLine", spec.names[1]],
      ["forgedSelectorLine", spec.names[2]],
    ]) {
      assert.ok(lines[proof[field] - 1].includes("const " + name + " = expectStatus(await request("),
        spec.route + ": exact live request missing at " + field);
    }
    assert.ok(lines[proof.victimExistsLine - 1].includes("assert.equal(" + spec.exists),
      spec.route + ": persisted victim organization not verified");
    assert.ok(lines[proof.victimIdOrderingLine - 1].trim().startsWith("assert.ok(") &&
      lines.slice(proof.victimIdOrderingLine - 1, proof.victimIdOrderingLine + 2)
        .join("\n").includes(spec.order), spec.route + ": real higher-ID victim ordering lost");
    assert.ok(lines[proof.unchangedDbLine - 1].includes("assert.deepEqual(after, before,"),
      spec.route + ": unchanged victim PG snapshot lost");
    const span = (line) => lines.slice(line - 1, line + 12).join("\n");
    assert.ok(span(proof.ownPositiveLine).includes("}), 200,"), spec.route + ": own HTTP 200 required");
    assert.ok(span(proof.foreignDenialLine).includes("}), 403,"), spec.route + ": real victim HTTP 403 required");
    assert.ok(span(proof.forgedSelectorLine).includes("}), " + spec.forgedStatus + ","),
      spec.route + ": forged victim selector must return exact expected status");
    assert.ok(proof.ownPositiveLine < proof.foreignDenialLine &&
      proof.foreignDenialLine < proof.forgedSelectorLine &&
      proof.forgedSelectorLine < proof.unchangedDbLine);
    assert.ok(overviewHasLink(spec.route, spec.method, proof.ownPositiveLine),
      spec.route + ": client-facing inventory lacks exact method proof");
  }
  assert.equal(manifest.metrics.methods, 493);
  assert.deepEqual([manifest.metrics.coveredAfter, manifest.metrics.publicByDesign, manifest.metrics.gap],
    [150, 10, 333]);
  assert.equal(manifest.scopedPages.length, 20);
  assert.equal(manifest.scopedPages.filter(x => x.status === "GAP").length, 19);
  const coveredPages = manifest.scopedPages.filter(x => x.status === "COVERED");
  assert.deepEqual(coveredPages.map(x => x.path), ["src/app/hcm/manager-decision-inbox/page.tsx"]);
  assert.equal(coveredPages[0].testedBy?.file, "scripts/qa/hcm-manager-inbox-page-http.mjs");
  assert.ok(manifest.acceptanceStatus.startsWith("NOT ACCEPTED: 333 API methods"));
});
test("existing employee CSV export retains prior independent proof, not double-credited", () => {
  const record = manifest.allApiRouteFiles["src/app/api/exports/route.ts"].methods.find(x => x.name === "GET");
  assert.equal(record?.status, "COVERED");
  assert.equal(record?.testedBy?.file, "scripts/qa/tenant-high-risk-01-http.mjs");
  assert.ok(src.includes("const ownExport = expectStatus(await request("),
    "Follow-on CSV case remains an additional regression, not a newly closed method");
});

test("forged selectors preserve every stable contribution and labor evidence field", () => {
  // These guards prevent removing the full-payload checks from the real
  // two-attacker HTTP/PG16 run; static tests alone are not tenant proof.
  assert.ok(src.includes("const { generatedAt: _generatedAt, evidenceHashSha256: _evidenceHashSha256, ...stableFields } = pack;"));
  assert.ok(src.includes("const { generatedAt: _generatedAt, ...stableFields } = pack;"));
  assert.match(src, /assert\.deepEqual\(\s*withoutContributionDownloadVolatiles\(forgedCase\.json\),\s*withoutContributionDownloadVolatiles\(ownCase\.json\)/);
  assert.match(src, /assert\.deepEqual\(\s*withoutLaborDownloadTimestamp\(forgedInspection\.json\),\s*withoutLaborDownloadTimestamp\(ownInspection\.json\)/);
  assert.ok(src.includes('forgedInspection.headers.get("x-payrollph-evidence-sha256")'));
  assert.ok(src.includes('ownInspection.headers.get("x-payrollph-evidence-sha256")'));
  assert.ok(src.includes("assert.match(forgedCase.json?.evidenceHashSha256"));
});
