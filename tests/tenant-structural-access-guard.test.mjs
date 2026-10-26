/**
 * All-API structural check: every direct/delegated route-to-DB call must show
 * an employer-scoped access mechanism OR a source-SHA-pinned exception with a
 * concrete reason in the master inventory. Historical GAPs are NOT approvals:
 * they are grandfathered *only until that exact handler changes*. New routes
 * and changes without evidence are blocked by the companion drift guard.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { inspectRouteHandler, traceFlaggedSource } from "../scripts/qa/tenant-delegated-trace.mjs";

const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const inventory = manifest.allApiRouteFiles;
const acceptable = new Set(["GAP", "COVERED", "PUBLIC-BY-DESIGN"]);
function blobSha(bytes) {
  return createHash("sha1").update(Buffer.from("blob " + bytes.length + "\0"))
    .update(bytes).digest("hex");
}

test("all 34 client-ID source candidates are traced, including delegated helpers", () => {
  const routes = traceFlaggedSource();
  assert.equal(routes.length, 34);
  assert.deepEqual(new Set(routes.map((r) => r.file)).size, 34);
  assert.ok(routes.some((r) => r.file.includes("payout-destination-changes")));
  assert.ok(routes.some((r) => r.file.includes("report-builder/saved")));
  assert.ok(routes.some((r) => r.file.includes("compliance/statutory-remittances/payment-evidence")));
  for (const route of routes) {
    assert.ok(route.methods.length > 0 && route.methods.every((m) => m.requiresRealHttp),
      route.file + " needs independent employer-positive/victim-denial proof");
    if (route.structuralStatus === "UNRESOLVED_DELEGATED_SCOPE") {
      assert.ok(route.methods.some((m) => !m.sourceGatePresent),
        "Unresolved means delegated access is NOT inferred as proven");
    }
  }
  console.log(JSON.stringify({ kind: "source-trace-only", flagged: 34,
    unverifiedOrUnresolved: routes.filter((r) => r.structuralStatus === "UNRESOLVED_DELEGATED_SCOPE")
      .map((r) => r.file),
    delegationSignals: routes.filter((r) => r.structuralStatus === "DELEGATED_GATE_FOUND_NOT_VERIFIED").length,
    boundaryCases: routes.filter((r) => r.publicBoundaryReason).map((r) => r.file),
    actualHttpCertificationsFromStaticAnalysis: 0 }));
});

test("exported GET/POST aliases are resolved to the same scoped handler, not exempted", () => {
  const route = "src/app/api/year-end/prior-evidence/route.ts";
  const source = readFileSync(route, "utf8");
  assert.match(source, /export const GET = respond;/);
  assert.match(source, /export const POST = respond;/);
  for (const method of ["GET", "POST"]) {
    const inspection = inspectRouteHandler(route, method);
    assert.ok(inspection, method + ": an exported alias with local implementation must be parsed");
    assert.ok(inspection.structuralAccessGuards.some((path) =>
      /assertOrganizationRole|getAccess/.test(path)), method + ": preserve scoped guard evidence");
    assert.equal(inspection.needsHttpProof, true, method + ": AST guard is never HTTP certification");
  }
});

test("all 495 handlers reaching PostgreSQL have a gate or explicit source-pinned exception", () => {
  let methods = 0, hitsDb = 0, guarded = 0;
  const legacyGaps = [], explicitPublic = [], evidenced = [], noDbFound = [];
  for (const [file, data] of Object.entries(inventory)) {
    const source = readFileSync(file);
    assert.equal(blobSha(source), data.gitBlobSha,
      file + ": changed route without refreshed proof and gate review");
    for (const method of data.methods) {
      methods++;
      assert.ok(acceptable.has(method.status));
      const finding = inspectRouteHandler(file, method.name);
      assert.ok(finding, file + " " + method.name + ": route AST cannot be parsed");
      if (!finding.accessesDatabase) { noDbFound.push(file + "#" + method.name); continue; }
      hitsDb++;
      if (finding.structuralAccessGuards.length) { guarded++; continue; }
      const id = file + "#" + method.name;
      // Source-pinned exceptions are narrowly tied to the *historical* exact
      // method and its unmodified contents, with an outstanding review reason.
      // These do NOT turn a GAP into COVERED and may not be copied to new code.
      assert.ok(typeof method.reason === "string" && method.reason.length > 22,
        id + ": missing explicit unguarded-method review reason");
      if (method.status === "GAP") {
        legacyGaps.push({ id, exactSourceSha: data.gitBlobSha,
          exceptionReason: "Unverified legacy handler blocked from certification: " + method.reason });
      } else if (method.status === "PUBLIC-BY-DESIGN") {
        assert.match(method.reason, /public|anonymous|static|status|health|webhook|token/i,
          id + ": public/signed protocol boundary needs explicit concrete justification");
        explicitPublic.push(id);
      } else if (method.status === "COVERED") {
        assert.ok(method.testedBy?.file && method.testedBy?.ownPositiveLine &&
          method.testedBy?.foreignDenialLine,
          id + ": indirect access needs real method-specific HTTP evidence, not a blanket bypass");
        evidenced.push(id);
      }
    }
  }
  assert.equal(methods, manifest.metrics.methods, "Structural scan must cover every exported HTTP method");
  assert.equal(methods, 495, "Whole-route scope regression, including verified manager direct-report GET");
  assert.equal(hitsDb, guarded + legacyGaps.length + explicitPublic.length + evidenced.length);
  // No route is silently omitted or certified because DB code lives in a helper.
  console.log(JSON.stringify({ kind: "source-structural-guard-NOT-security-certification",
    exportedMethods: methods, discoveredDbCallPaths: hitsDb,
    gatePathsDiscovered: guarded, currentSourcePinnedLegacyGaps: legacyGaps.length,
    publicBoundaryExemptions: explicitPublic.length,
    previouslyHttpEvidencedLegacyMethods: evidenced.length,
    noDbPathsProvenByStaticSearch: noDbFound.length,
    sourcePinnedExceptions: legacyGaps,
    reminder: "HTTP proof required; no historical GAP is certified" }));
});

test("all scoped pages stay source-pinned; only three exact independently probed pages may be provisional", () => {
  assert.equal(manifest.scopedPages.length, 21);
  const approvedPath = "src/app/hcm/manager-decision-inbox/page.tsx";
  const evidenceFile = "scripts/qa/hcm-manager-inbox-page-http.mjs";
  const directPath = "src/app/hcm/manager-direct-reports/page.tsx";
  const directEvidenceFile = "scripts/qa/hcm-manager-direct-reports-http.mjs";
  const covered = manifest.scopedPages.filter((page) => page.status === "COVERED");
  assert.deepEqual(covered.map((page) => page.path), ["src/app/app/page.tsx", approvedPath, directPath],
    "Static route analysis cannot silently certify any additional page");
  assert.equal(manifest.scopedPages.filter((page) => page.status === "GAP").length, 18,
    "Other 18 employer-scoped page/action entries remain uncertified");
  for (const page of manifest.scopedPages) {
    const bytes = readFileSync(page.path);
    assert.equal(blobSha(bytes), page.blob,
      page.path + ": page changed; rerun authenticated HTML/tenant tests");
    assert.ok(page.business.length > 0 && page.reason.length > 22);
    if (page.status === "GAP") {
      assert.ok(!page.testedBy, page.path + ": a GAP must not claim accepted HTTP evidence");
      continue;
    }
    if (page.path === "src/app/app/page.tsx") {
      const proof = page.testedBy;
      assert.equal(proof?.file, "scripts/qa/tenant-scoped-page-probes.mjs");
      const lines = readFileSync(proof.file, "utf8").split("\n");
      const suite = lines.join("\n");
      assert.match(lines[proof.ownPositiveLine - 1] ?? "", /const ownRes = await request\(pageUrl\(path, own\.id\), \{ cookie \}\)/);
      assert.match(lines[proof.foreignDenialLine - 1] ?? "", /const foreignRes = await request\(pageUrl\(path, victim\.id\), \{ cookie \}\)/);
      assert.match(suite, /for \(const idx of \[1, 2\]\)/);
      assert.match(suite, /if \(path === "src\/app\/app\/page\.tsx"\)/);
      assert.match(suite, /expectStatus\(ownRes, 200,/);
      assert.match(suite, /ownRes\.text\.includes\(own\.name\)/);
      assert.match(suite, /ownRes\.text\.includes\(f\.ownedEmployees\[idx - 1\]\.employeeNo\)/);
      assert.match(suite, /!ownRes\.text\.includes\("Workspace unavailable"\)/);
      assert.match(suite, /expectStatus\(foreignRes, 404,/);
      assert.match(suite, /assert\.deepEqual\(await db\.select\(\)\.from\(employees\)/);
      assert.match(suite, /assert\.deepEqual\(await db\.select\(\)\.from\(payrollRuns\)/);
      assert.match(readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8"), /probeManifestBusinessPages\(f, \{ request, makeSession, expectStatus \}\)/);
      continue;
    }
    if (page.path === directPath) {
      const proof = page.testedBy;
      assert.equal(proof?.file, directEvidenceFile);
      const lines = readFileSync(directEvidenceFile, "utf8").split("\n");
      assert.match(lines[proof.line - 1] ?? "",
        /export async function verifyHcmManagerDirectReports/);
      assert.match(lines[proof.ownPositiveLine - 1] ?? "",
        /const ownPage = await requestOn\(PAGE \+ "\?organizationId=" \+ own\.id, cookie\)/);
      assert.match(lines[proof.foreignDenialLine - 1] ?? "",
        /const foreignPage = await requestOn\(PAGE \+ "\?organizationId=" \+ victim\.id, cookie\)/);
      assert.match(lines[proof.unchangedDbLine - 1] ?? "",
        /victimWorkersBefore, "Denied manager reads must not modify victim employees"/);
      const suite = lines.join("\n");
      assert.match(suite, /HCM_MANAGER_TEAM_ENABLED: "true"/);
      assert.match(suite, /HCM_MANAGER_TEAM_ORG_IDS: f\.orgs\.map/);
      assert.match(suite, /for \(const idx of \[1, 2\]\)/);
      assert.match(suite, /assert\.equal\(ownPage\.status, 200/);
      assert.match(suite, /assert\.equal\(foreignPage\.status, 404/);
      assert.match(suite, /assert\.equal\(foreignApi\.status, 403/);
      assert.match(suite, /assert\.equal\(offApi\.status, 404/);
      assert.match(suite, /makeSession\(manager\.id, \{ privileged: true \}\)/);
      const runner = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
      assert.match(runner, /verifyHcmManagerDirectReports\(f, \{ makeSession \}\)/);
      continue;
    }
    assert.equal(page.path, approvedPath, "No blanket exception for changed pages");
    const proof = page.testedBy;
    assert.equal(proof?.file, evidenceFile,
      "Only the separately feature-enabled, two-attacker HTTP suite can back this page");
    const lines = readFileSync(evidenceFile, "utf8").split("\n");
    assert.match(lines[proof.line - 1] ?? "", /export async function verifyHcmManagerInboxPage/);
    assert.match(lines[proof.ownPositiveLine - 1] ?? "",
      /const ownPage = await requestOn\(PAGE \+ "\?organizationId=" \+ own\.id, cookie\)/);
    assert.match(lines[proof.foreignDenialLine - 1] ?? "",
      /const foreignPage = await requestOn\(PAGE \+ "\?organizationId=" \+ victim\.id, cookie\)/);
    assert.match(lines[proof.unchangedDbLine - 1] ?? "",
      /victimWorkersBefore, "Denied page and API reads cannot change victim employees"/);
    const suite = lines.join("\n");
    const runner = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
    assert.match(suite, /HCM_MANAGER_DECISION_INBOX_ENABLED: "true"/);
    assert.match(suite, /HCM_MANAGER_DECISION_INBOX_ORG_IDS: f\.orgs\.map/);
    assert.match(suite, /for \(const idx of \[1, 2\]\)/);
    assert.match(suite, /assert\.equal\(ownPage\.status, 200/);
    assert.match(suite, /assert\.equal\(foreignPage\.status, 404/);
    assert.match(suite, /assert\.equal\(foreignApi\.status, 403/);
    assert.match(runner,
      /await \(await import\("\.\/hcm-manager-inbox-page-http\.mjs"\)\)\.verifyHcmManagerInboxPage\(f\)/);
  }
});
