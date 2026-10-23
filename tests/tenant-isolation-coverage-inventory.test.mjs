/**
 * Complete-surface tenant-isolation manifest and drift guard.
 *
 * Existing untested methods are OPEN GAPs, never certified as safe by this test.
 * An unchanged, source-pinned historical GAP can remain only while it is being
 * resolved; every new/modified route with an employer-scoped handler must bring
 * valid own-tenant + real victim-denial evidence or a public-by-design rationale.
 *
 * This test supplements (never replaces) the existing second-pass inventory and
 * the isolated PostgreSQL live HTTP security smoke.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import test from "node:test";

const ROOT = "src/app";
const API = "src/app/api";
const BASE = "8c2a62135fd6e23db4603197822339cc1020ec27";
const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const baseline = JSON.parse(readFileSync("scripts/qa/tenant-isolation-inventory/baseline.json", "utf8"));

function normalize(value) { return value.split(sep).join("/"); }
function allFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? allFiles(path) : [normalize(path)];
  });
}
function routeFiles() {
  return allFiles(API).filter((file) => file.endsWith("/route.ts")).sort();
}
function appFiles() {
  return allFiles(ROOT).filter((file) =>
    !file.startsWith(API + "/") && /\.(?:ts|tsx|js|jsx)$/.test(file)
  ).sort();
}
function methodsIn(source) {
  return [...source.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+(GET|POST|PATCH|PUT|DELETE|OPTIONS|HEAD)\b/g)]
    .map((match) => match[1]).sort();
}
function gitBlobSha(bytes) {
  return createHash("sha1").update(Buffer.from("blob " + bytes.length + "\0"))
    .update(bytes).digest("hex");
}
function readableLines(path) {
  return readFileSync(path, "utf8").split("\n");
}
function evidenceLine(path, number, subject) {
  assert.equal(typeof path, "string", subject + ": test path required");
  assert.match(path, /^(?:tests\/|scripts\/qa\/)/, subject + ": test must live in a test/QA source");
  const lines = readableLines(path);
  assert.ok(Number.isInteger(number) && number > 0 && number <= lines.length,
    subject + ": proof requires an existing file:line reference");
  return lines[number - 1];
}
function reviewedStatus(method, key, isNewOrChanged, currentBlob) {
  assert.ok(["COVERED", "PUBLIC-BY-DESIGN", "GAP"].includes(method.status),
    key + ": invalid coverage status");
  if (method.status === "PUBLIC-BY-DESIGN") {
    assert.ok(typeof method.reason === "string" && method.reason.trim().length >= 20,
      key + ": public endpoint needs a concrete reviewed reason");
  }
  if (method.status === "COVERED") {
    const proof = method.testedBy;
    assert.ok(proof && typeof proof === "object", key + ": COVERED requires a valid proof reference");
    evidenceLine(proof.file, proof.line, key);
    if (isNewOrChanged) {
      // Newly introduced or changed code cannot borrow a single anonymous/invalid-request
      // status assertion as proof of actual cross-employer isolation.
      evidenceLine(proof.file, proof.ownPositiveLine, key + " attacker-own positive");
      evidenceLine(proof.file, proof.foreignDenialLine, key + " victim-only denial");
      if (["POST", "PATCH", "PUT", "DELETE"].includes(method.name)) {
        evidenceLine(proof.file, proof.unchangedDbLine, key + " DB unchanged");
      }
    }
  }
  if (isNewOrChanged && method.status === "GAP" &&
      key === "src/app/api/payroll-runs/[id]/payout-reconciliation/route.ts POST") {
    // Sole SHA-pinned exclusion: a provider-disabled 501 is access-control
    // evidence, never proof of a completed real payment or a safe retry.
    // Changes to the payout route invalidate this review and re-block CI.
    const proof = method.reviewedUncertified;
    assert.equal(currentBlob, "4a0f56c5e22127a1d74dd63ef2963df53edb6060",
      "New payout POST source requires renewed separate owner/provider review");
    assert.equal(proof?.routeBlobSha, currentBlob);
    assert.equal(proof?.file, "scripts/qa/tenant-second-pass-http.mjs");
    const own = evidenceLine(proof.file, proof.ownPositiveLine, key + " owned provider-disabled");
    const foreign = evidenceLine(proof.file, proof.foreignDenialLine, key + " real victim denial");
    const unchanged = evidenceLine(proof.file, proof.unchangedDbLine, key + " unchanged victim");
    const lines = readableLines(proof.file);
    const ownSpan = lines.slice(proof.ownPositiveLine - 1, proof.ownPositiveLine + 3).join("\n");
    const foreignSpan = lines.slice(proof.foreignDenialLine - 1, proof.foreignDenialLine + 3).join("\n");
    assert.ok(own.includes('const ownDisabledPayoutPost = expectStatus') &&
      own.includes('run.id + "/payout-reconciliation"') &&
      ownSpan.includes('method: "POST"') && ownSpan.includes('}), 501,'),
      "Owned payout operation must actually reach the provider-disabled 501 after authentication");
    assert.ok(foreign.includes('f.victimRun.id + "/payout-reconciliation"') &&
      foreignSpan.includes('method: "POST"') && foreignSpan.includes('}), 403,'),
      "Real victim payroll reconciliation POST must be explicitly denied");
    assert.match(unchanged, /assert\.deepEqual\(victimAfter, victimBefore/,
      "Denied payout POST must leave actual victim payroll unchanged");
    assert.equal(method.testedBy, null, "Payout POST remains uncertified, never COVERED");
    return;
  }
  if (isNewOrChanged && method.status === "GAP" &&
      key === "src/app/api/readiness/workspace/route.ts GET") {
    // A 503 own read is NOT a successful readiness read. The sole approved
    // exception is a SHA-pinned deny-by-default endpoint and executable,
    // independent foreign-denial proof; the method stays GAP.
    const proof = method.reviewedUncertified;
    assert.equal(currentBlob, "10121c3378f2e4ee983ab9b9551498a6f8dccdfd",
      "Changes to the readiness route must renew containment review");
    assert.equal(proof?.routeBlobSha, currentBlob);
    assert.equal(proof?.file, "scripts/qa/workspace-readiness-http.mjs");
    assert.equal(proof?.ownStatus, 503);
    assert.equal(proof?.foreignStatus, 403);
    const own = evidenceLine(proof.file, proof.ownPositiveLine, key + " own 503");
    const foreign = evidenceLine(proof.file, proof.foreignDenialLine, key + " foreign 403");
    const lines = readableLines(proof.file);
    const ownSpan = lines.slice(proof.ownPositiveLine - 1, proof.ownPositiveLine + 3).join("\n");
    assert.match(own, /const ownReadinessUnavailable = expectStatus\(await request\(/);
    assert.match(ownSpan, /\), 503,/);
    assert.match(foreign, /expectStatus\(await request\(/);
    assert.match(foreign, /\), 403,/);
    assert.match(lines.join("\n"), /TENANT_SECOND_PASS_MODE/);
    assert.match(readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8"),
      /verifyWorkspaceReadinessIsolation\(f, \{ request, expectStatus \}\)/);
    assert.match(readFileSync("src/app/api/readiness/workspace/route.ts", "utf8"),
      /return tenantReadinessUnavailable\(organizationId\)/);
    assert.equal(method.testedBy, null, "No successful owned readiness read: keep GAP");
    return;
  }
  if (isNewOrChanged) {
    assert.notEqual(method.status, "GAP",
      key + ": new/changed route must have real cross-tenant proof or a documented public-by-design review");
  }
}

test("whole API manifest inventories exactly every route, exported method, and original blob", () => {
  assert.equal(manifest.baseCommit, BASE);
  assert.equal(baseline.baseCommit, BASE);
  const files = routeFiles();
  const declared = Object.keys(manifest.allApiRouteFiles).sort();
  assert.deepEqual(declared, files,
    "new/removed route files require an explicit method-level isolation manifest review");
  assert.equal(Object.keys(baseline.api).length, 288,
    "original baseline scope is pinned to the audited 288-route snapshot");

  let count = 0;
  let covered = 0;
  let publicByDesign = 0;
  let gaps = 0;
  for (const path of files) {
    const sourceBytes = readFileSync(path);
    const currentBlob = gitBlobSha(sourceBytes);
    const record = manifest.allApiRouteFiles[path];
    assert.equal(record.gitBlobSha, currentBlob,
      path + ": route changed without re-inventory; update manifest SHA, handlers and proof");
    const currentMethods = methodsIn(sourceBytes.toString("utf8"));
    const declaredMethods = record.methods.map((method) => method.name).sort();
    assert.ok(currentMethods.length > 0, path + ": unsupported/unparsed method exports require review");
    assert.deepEqual(declaredMethods, currentMethods,
      path + ": new or changed exported HTTP method must be inventoried");
    const changed = !baseline.api[path] || baseline.api[path] !== currentBlob;
    for (const method of record.methods) {
      reviewedStatus(method, path + " " + method.name, changed, currentBlob);
      covered += method.status === "COVERED" ? 1 : 0;
      publicByDesign += method.status === "PUBLIC-BY-DESIGN" ? 1 : 0;
      gaps += method.status === "GAP" ? 1 : 0;
      count++;
    }
  }
  assert.equal(files.length, manifest.metrics.routeFiles);
  assert.equal(count, manifest.metrics.methods);
  assert.equal(covered, manifest.metrics.coveredAfter);
  assert.equal(publicByDesign, manifest.metrics.publicByDesign);
  assert.equal(gaps, manifest.metrics.gap);
  assert.equal(covered + publicByDesign + gaps, count);
  assert.equal(manifest.acceptanceStatus.startsWith("NOT ACCEPTED"), true,
    "existing uncovered methods must not be described as accepted");
});

test("#1302 verifies actual own/foreign first-payroll and legal-employer HTTP without certifying provider payout", () => {
  const workflow = readFileSync(".github/workflows/draft-1302-tenant-read-proof.yml", "utf8");
  const harness = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
  const testSource = readFileSync("scripts/qa/pr-1302-tenant-proof.mjs", "utf8");
  assert.match(workflow, /FIRST_PAYROLL_INLINE_ENABLED: "true"/);
  assert.match(workflow, /TENANT_1302_FIRST_PAYROLL_PROOF: isolated-ci-only/);
  assert.match(harness, /if \(process\.env\.TENANT_1302_FIRST_PAYROLL_PROOF === "isolated-ci-only"\)/);
  assert.match(harness, /verifyFirstPayrollTenantRead\(f, \{ request, expectStatus \}\)/);
  assert.match(harness, /verifyLegalEmployerTenantMutations\(f, \{ request, expectStatus \}\)/);
  assert.match(testSource, /assert\.deepEqual\(victimProgressAfter, victimProgressBefore/);
  assert.match(testSource, /assert\.deepEqual\(victimLegalAfter, victimLegalBefore/);
  for (const [route, methods] of [
    ["first-payroll/preview", ["GET"]],
    ["first-payroll/progress", ["GET", "PATCH"]],
    ["legal-entities", ["POST", "PATCH"]],
  ]) {
    const record = manifest.allApiRouteFiles["src/app/api/" + route + "/route.ts"];
    for (const name of methods) {
      const method = record.methods.find((item) => item.name === name);
      assert.equal(method?.status, "COVERED");
      assert.equal(method.testedBy?.file, "scripts/qa/pr-1302-tenant-proof.mjs");
      const own = evidenceLine(method.testedBy.file, method.testedBy.ownPositiveLine, route + " own");
      const denied = evidenceLine(method.testedBy.file, method.testedBy.foreignDenialLine, route + " foreign");
      assert.ok(own.includes("expectStatus(await request(") && own.includes("/api/" + route),
        route + " " + name + ": positive must target a real owned route");
      assert.ok(denied.includes("expectStatus(await request(") && denied.includes("/api/" + route),
        route + " " + name + ": denial must target the same route");
      const lines = testSource.split("\n");
      const ownStatus = name === "POST" ? 201 : 200;
      const ownSpan = lines.slice(method.testedBy.ownPositiveLine - 1, method.testedBy.ownPositiveLine + 5).join("\n");
      const deniedSpan = lines.slice(method.testedBy.foreignDenialLine - 1, method.testedBy.foreignDenialLine + 5).join("\n");
      assert.ok(ownSpan.includes("), " + ownStatus + ",") &&
        deniedSpan.includes("), 403,"), route + " " + name + ": must assert successful own and forbidden foreign status");
      if (name === "POST" || name === "PATCH") {
        assert.ok(ownSpan.includes('method: "' + name + '"') &&
          deniedSpan.includes('method: "' + name + '"'), "Mutation proof must use the claimed method");
        const unchanged = evidenceLine(method.testedBy.file, method.testedBy.unchangedDbLine, route + " unchanged");
        assert.match(unchanged, /assert\.deepEqual\(victim(?:Progress|Legal)After, victim(?:Progress|Legal)Before/);
      }
    }
  }
  const payout = manifest.allApiRouteFiles["src/app/api/payroll-runs/[id]/payout-reconciliation/route.ts"]
    .methods.find((item) => item.name === "POST");
  assert.equal(payout?.status, "GAP");
  assert.equal(payout?.testedBy, null);
  assert.equal(manifest.metrics.gap, 342, "Keep all 342 unverified API method gaps after separate BIR and vault proofs");
  assert.equal(manifest.metrics.coveredAfter, 141, "Count exact linked PG16 BIR and vault method proofs without treating GAPs as successes");
});

test("#641 correction cases prove own success, victim denial and unchanged victim rows over real HTTP", () => {
  const workflow = readFileSync(".github/workflows/salary-correction-cases-qa.yml", "utf8");
  const harness = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
  const file = "scripts/qa/salary-correction-case-tenant-proof.mjs";
  const lines = readFileSync(file, "utf8").split("\n");
  assert.match(workflow, /HCM_SALARY_CORRECTION_CASES_ENABLED: "true"/);
  assert.match(workflow, /TENANT_641_SALARY_CORRECTION_CASE_PROOF: isolated-ci-only/);
  assert.match(workflow, /PAYROLL_UNDERPAYMENT_POSTING_ENABLED: "false"/);
  assert.match(harness, /if \(process\.env\.TENANT_641_SALARY_CORRECTION_CASE_PROOF === "isolated-ci-only"\) await/);
  assert.match(harness, /verifySalaryCorrectionCaseTenantIsolation\(f, \{ request, expectStatus \}\)/);
  assert.match(lines.join("\n"), /process\.env\.TENANT_SECOND_PASS_MODE, "isolated-ci-only"/);
  assert.match(lines.join("\n"), /for \(const idx of \[1, 2\]\)/);
  const record = manifest.allApiRouteFiles["src/app/api/hcm/salary-corrections/cases/route.ts"];
  for (const [name, ownStatus] of [["GET", 200], ["POST", 201], ["PATCH", 200]]) {
    const method = record.methods.find((item) => item.name === name);
    assert.equal(method?.status, "COVERED");
    assert.equal(method.testedBy?.file, file);
    const ownSpan = lines.slice(method.testedBy.ownPositiveLine - 1, method.testedBy.ownPositiveLine + 2).join("\n");
    const deniedSpan = lines.slice(method.testedBy.foreignDenialLine - 1, method.testedBy.foreignDenialLine + 3).join("\n");
    assert.ok(ownSpan.includes("expectStatus(await request(\"/api/hcm/salary-corrections/cases") && ownSpan.includes("), " + ownStatus + ","),
      name + ": positive must be a successful request to the claimed route");
    assert.ok(deniedSpan.includes("expectStatus(await request(\"/api/hcm/salary-corrections/cases") && deniedSpan.includes("victim.id") &&
      deniedSpan.includes("), 403,"), name + ": denial must name the real victim employer and assert 403");
    if (name !== "GET") {
      assert.ok(ownSpan.includes('method: "' + name + '"') && deniedSpan.includes('method: "' + name + '"'),
        "Mutation proof must use the claimed method");
      assert.match(lines[method.testedBy.unchangedDbLine - 1], /assert\.deepEqual\(victimCasesAfter, victimCasesBefore/);
    }
  }
  assert.match(lines.join("\n"), /assert\.deepEqual\(victimCaseRunsAfter, victimCaseRunsBefore/);
  assert.match(lines.join("\n"), /assert\.deepEqual\(victimAuditAfter, victimAuditBefore/);
});

test("DL-02 proofs distinguish cross-tenant denials from employee membership revocation", () => {
  const workflow = readFileSync(".github/workflows/tenant-dl02-qa.yml", "utf8");
  const harness = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
  const file = "scripts/qa/tenant-dl02-http.mjs";
  const source = readFileSync(file, "utf8");
  const lines = source.split("\n");
  assert.match(workflow, /TENANT_DL02_PROOF: isolated-ci-only/);
  assert.match(workflow, /MULTI_ENTITY_ENABLED: "false"/);
  assert.match(harness, /if \(process\.env\.TENANT_DL02_PROOF === "isolated-ci-only"\) await \(await import\("\.\/tenant-dl02-http\.mjs"\)\)\.verifyDl02TenantIsolation\(f, \{ request, expectStatus, makeSession \}\)/);
  assert.match(source, /process\.env\.TENANT_SECOND_PASS_MODE, "isolated-ci-only"/);
  assert.match(source, /for \(const idx of \[1, 2\]\)/);
  assert.match(source, /Victim-only DL02 ID must really exist and exceed 6 and both attacker object IDs/);
  assert.match(source, /assert\.deepEqual\(victimAfter, victimBefore/);
  // Do not revert to VICTIM-first fixtures: the real seeded victim target IDs
  // must exceed BOTH attacker-owned IDs, not merely a fixed sequence floor.
  const attackerSeed = source.indexOf('for (const label of ["ATTA", "ATTB"])');
  const actualOwnPost = source.indexOf("const ownSavedPost = expectStatus");
  const victimSeed = source.indexOf('const victim = await seedEmployer("VICTIM"');
  assert.ok(attackerSeed >= 0 && attackerSeed < actualOwnPost && actualOwnPost < victimSeed,
    "Both attacker employers and real own saved-report POSTs must precede the victim");
  assert.match(source, /attackerIds\.every\(\(ownId\) => Number\.isSafeInteger\(ownId\) && victimId > ownId\)/);
  assert.match(source, /persisted, \{ id: victimId, organizationId: victim\.org\.id \}/);
  for (const type of ["decisions", "terms", "employees", "payrollRuns",
    "payrollEntries", "performanceCycles", "performanceReviews"]) {
    assert.ok(source.includes(type + ": await db.select"),
      "Victim snapshot must include persisted " + type + " state");
  }
  assert.match(source, /const ownPeople = await db\.select/);
  assert.match(source, /assert\.notEqual\(ownHeadcount, victimHeadcount/);
  assert.match(source, /HCM report output must match real seeded own-employer employees/);
  assert.match(source, /Report builder must return all actual own employees in ID order/);
  assert.match(source, /performanceCycle\.id/);
  assert.match(source, /performanceReview\.id/);
  assert.match(source, /Export evidence identity hash must match actual content/);
  assert.match(source, /The download SHA256 response header must match real exported evidence/);
  // Revoked-membership denials must follow a real own success with the same session.
  assert.ok(source.indexOf("const ownPhotoGet = expectStatus") < source.indexOf("set({ active: false })") &&
    source.indexOf("set({ active: false })") < source.indexOf("Former employee photo GET denied"));
  const revokedOnly = new Set([
    "src/app/api/self/contribution-evidence/route.ts GET",
    "src/app/api/self/photo/route.ts GET",
    "src/app/api/self/photo/route.ts HEAD",
    "src/app/api/self/photo/route.ts DELETE",
  ]);
  let revokedCount = 0;
  let count = 0;
  for (const [path, record] of Object.entries(manifest.allApiRouteFiles)) {
    for (const method of record.methods) {
      if (method.testedBy?.file !== file) continue;
      count += 1;
      const key = path + " " + method.name;
      assert.equal(method.status, "COVERED", key);
      const own = lines[method.testedBy.ownPositiveLine - 1] ?? "";
      const ownSpan = lines.slice(method.testedBy.ownPositiveLine - 1, method.testedBy.ownPositiveLine + 3).join("\n");
      const deniedSpan = lines.slice(method.testedBy.foreignDenialLine - 1, method.testedBy.foreignDenialLine + 3).join("\n");
      assert.match(own, /const own[A-Za-z]+ = expectStatus\(await request\("\/api\//, key + ": own positive must be a real request");
      assert.ok(own.includes("/api/" + record.route.split("/[")[0]), key + ": own positive must target the claimed route");
      assert.match(ownSpan, /\), 20[01],/, key + ": own positive must assert success");
      assert.match(lines[method.testedBy.foreignDenialLine - 1], /expectStatus\(await request\("\/api\//, key + ": denial must be a real request");
      assert.ok(/\), 40[34],/.test(deniedSpan), key + ": denial must assert exact 403 or 404");
      assert.ok(/victim\.|Former employee/.test(deniedSpan), key + ": denial must name a real victim object or revoked membership");
      if (revokedOnly.has(key)) {
        revokedCount++;
        assert.equal(method.testedBy.denialKind, "same-session-revoked-membership",
          key + ": label same-session revocation instead of claiming a forged victim ID");
        assert.match(method.reason, /same signed-in session receives 403 after that employee's active employer membership is revoked/,
          key + ": the reason must describe the real route-specific denial");
        assert.match(deniedSpan, /Former employee/,
          key + ": the negative HTTP request must be the revoked employee's own session");
      } else {
        assert.equal(method.testedBy.denialKind, undefined,
          key + ": ordinary foreign-employer/object proof must not be labeled session revocation");
        const ordering = method.testedBy.victimIdOrderingLine;
        assert.ok(Number.isSafeInteger(ordering), key + ": missing real victim-versus-attacker ordering line");
        assert.match(lines[ordering - 1],
          /Victim-only DL02 ID must really exist and exceed 6 and both attacker object IDs/,
          key + ": victim ID ordering must compare both actual attackers");
      }
      if (new Set(["hcm-report-builder GET", "reports/builder GET"]).has(record.route + " " + method.name)) {
        assert.equal(method.testedBy.positiveKind, "authorized-tenant-gated-field-catalog",
          key + ": do not mislabel GET field metadata as owned rows");
        assert.match(lines[method.testedBy.catalogAssertionLine - 1], /headcount/,
          key + ": require nonempty authorized field catalog assertion");
      }
      if (new Set(["hcm-report-builder POST", "reports/builder POST"]).has(record.route + " " + method.name)) {
        assert.equal(method.testedBy.positiveKind, "owned-nonempty-employee-report",
          key + ": require real seeded own-employee data");
        assert.match(lines[method.testedBy.contentAssertionLine - 1],
          /HCM report output must match real seeded own-employer employees|Report builder must return all actual own employees in ID order/,
          key + ": positive report must check real owned content, not merely column names");
      }
      if (record.route === "performance/evidence" && method.name === "GET") {
        assert.equal(method.testedBy.positiveKind, "scoped-json-download-verified-hashes",
          key + ": performance download must validate real own JSON and hashes");
        assert.match(lines[method.testedBy.contentAssertionLine - 1],
          /Export evidence identity hash must match actual content/,
          key + ": verify actual downloaded evidence identity hash");
      }
      if (["POST", "PATCH", "PUT", "DELETE", "HEAD"].includes(method.name)) {
        assert.ok(ownSpan.includes('method: "' + method.name + '"') && deniedSpan.includes('method: "' + method.name + '"'),
          key + ": proof must use the claimed method");
      }
      if (["POST", "PATCH", "PUT", "DELETE"].includes(method.name)) {
        assert.match(lines[method.testedBy.unchangedDbLine - 1], /assert\.deepEqual\(victimAfter, victimBefore/);
      }
    }
  }
  assert.equal(revokedCount, 4, "Four self-service methods prove same-session membership revocation");
  assert.equal(count, 19, "Nineteen DL-02 part-1 methods are credited; the rest stay GAP");
});

test("new dashboard, employee-directory and payroll-list coverage cites executable own/foreign HTTP proof", () => {
  // Tests are actually run in disposable PG16 by Security HTTP Smoke; this
  // inventory assertion stops a future manifest edit from substituting an
  // anonymous probe or a line that does not exercise the claimed route.
  for (const [route, ownToken, denialToken] of [
    ["dashboard", "const ownDashboard = expectStatus", "expectStatus(await request"],
    ["employees", "const ownDirectory = expectStatus", "expectStatus(await request"],
    ["payroll-runs", "const ownRunList = expectStatus", "expectStatus(await request"],
  ]) {
    const key = "src/app/api/" + route + "/route.ts";
    const method = manifest.allApiRouteFiles[key]?.methods.find((item) => item.name === "GET");
    assert.equal(method?.status, "COVERED", key + ": proof must remain classified");
    const proof = method.testedBy;
    assert.equal(proof?.file, "scripts/qa/tenant-second-pass-http.mjs", key + ": not a real HTTP harness");
    const positive = evidenceLine(proof.file, proof.ownPositiveLine, key + " own-positive");
    const negative = evidenceLine(proof.file, proof.foreignDenialLine, key + " foreign-denial");
    assert.ok(positive.includes(ownToken) && positive.includes('"/api/' + route + '?') &&
      positive.includes(", 200,"), key + ": missing own-tenant HTTP 200 control");
    assert.ok(negative.includes(denialToken) && negative.includes('"/api/' + route + '?') &&
      negative.includes("victim.id") && negative.includes(", 403,"),
      key + ": missing actual victim-tenant denied HTTP request");
  }
  const source = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
  assert.match(source, /f\.victimRun\.id \+ "&include=entries".*\{ cookie: attackerCookie \}\), 403/,
    "The payroll run read must also deny a direct victim-only register ID");
});

test("reconciled main hashes retain documented GAPs without inventing authorization proof", () => {
  // Main updated HR Inbox metadata and Payroll Register response metadata after
  // the original inventory. Those pre-existing changes require re-inventory,
  // not new COVERED claims or broad exemptions from the source fingerprint.
  for (const route of ["attendance/offline-claims", "web-bundy/review"]) {
    const path = "src/app/api/" + route + "/route.ts";
    assert.equal(manifest.allApiRouteFiles[path].gitBlobSha, baseline.api[path],
      path + ": the reviewed main source and active inventory SHA must match");
  }
  const hr = manifest.allApiRouteFiles["src/app/api/hr-cases/route.ts"];
  assert.ok(hr.methods.every((method) => method.status === "COVERED" && method.testedBy),
    "HR methods require the new executed HTTP controls, not hash refresh alone");
  const payroll = manifest.allApiRouteFiles["src/app/api/payroll-runs/route.ts"];
  assert.equal(payroll.methods.find((method) => method.name === "POST")?.status, "COVERED",
    "Payroll draft creation requires executed own/foreign HTTP and unchanged-victim proof");
  assert.equal(payroll.methods.find((method) => method.name === "GET")?.status, "COVERED",
    "Retain the real three-employer HTTP GET proof, subject to current-head CI");
  const bundy = manifest.allApiRouteFiles["src/app/api/web-bundy/review/route.ts"];
  assert.ok(bundy.methods.length === 2 && bundy.methods.every((method) => method.status === "GAP"),
    "Web Bundy photo/review response-scoping changes do not prove authorization for GET or POST");
  const offline = manifest.allApiRouteFiles["src/app/api/attendance/offline-claims/route.ts"];
  assert.ok(offline.methods.every((method) => method.status === "GAP"),
    "Newly merged offline-attendance scope metadata does not replace own/victim/role HTTP proof");
});

test("extended three-employer reads and asset writes have checkable method-specific proof", () => {
  const source = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8").split("\n");
  for (const [route, method, ownStatus, expectedToken] of [
    ["assets", "GET", 200, "ownAssetsResult"],
    ["assets", "POST", 201, "ownCreatedAsset"],
    ["assets", "PATCH", 200, "ownPatchedAsset"],
    ["assets", "DELETE", 200, "ownDeletedAsset"],
    ["approval-chains", "GET", 200, "ownApprovalsResult"],
    ["leave/balances", "GET", 200, "ownLeaveResult"],
    ["compliance/calendar", "GET", 200, "ownComplianceResult"],
    ["documents", "GET", 200, "ownDocumentsResult"],
  ]) {
    const key = "src/app/api/" + route + "/route.ts";
    const entry = manifest.allApiRouteFiles[key].methods.find((item) => item.name === method);
    assert.equal(entry?.status, "COVERED", key + " " + method + ": requires positive/negative evidence");
    const proof = entry.testedBy;
    assert.equal(proof?.file, "scripts/qa/tenant-second-pass-http.mjs",
      key + " " + method + ": fixture must be real disposable-PostgreSQL HTTP");
    const ownLine = evidenceLine(proof.file, proof.ownPositiveLine, key + " " + method + " own-positive");
    const foreignLine = evidenceLine(proof.file, proof.foreignDenialLine, key + " " + method + " victim denial");
    const ownSpan = source.slice(proof.ownPositiveLine - 1, proof.ownPositiveLine + 6).join("\n");
    const foreignSpan = source.slice(proof.foreignDenialLine - 1, proof.foreignDenialLine + 5).join("\n");
    assert.ok(ownLine.includes("const " + expectedToken + " = expectStatus") &&
      ownLine.includes('"/api/' + route) &&
      ownSpan.includes("cookie: attackerCookie") &&
      ownSpan.includes("), " + ownStatus + ","),
      key + " " + method + ": own-side request needs real successful scoped data");
    assert.ok(foreignLine.includes('expectStatus(await request("/api/' + route) &&
      foreignSpan.includes("cookie: attackerCookie") &&
      foreignSpan.includes("), 403,") &&
      (foreignSpan.includes("victim.id") || foreignSpan.includes("f.syntheticAssets[7].id")),
      key + " " + method + ": denial must name a real victim organization/object");
    if (method !== "GET") {
      assert.equal(method === "POST" || method === "PATCH" || method === "DELETE", true);
      const invariant = evidenceLine(proof.file, proof.unchangedDbLine, key + " " + method + " unchanged victim data");
      assert.ok(invariant.includes("assert.deepEqual(victimAssetsAfter, victimAssetsBefore"),
        key + " " + method + ": cross-tenant asset write must leave victim DB unchanged");
    }
  }
});


test("new sensitive download, legal-employer, leave mutation, and ESS proofs are real", () => {
  // The HTTP suite executes with actual seeded PostgreSQL rows and two
  // independent attackers. These assertions disallow a future manifest edit
  // from citing only an invalid ID, unrelated route, or anonymous 401.
  const source = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8").split("\n");
  const cases = [
    { route: "documents/[id]", method: "GET", own: "ownDocumentDownload",
      prefix: "/api/documents/", success: 200, deny: 403 },
    { route: "legal-entities", method: "GET", own: "ownLegalEntities",
      prefix: "/api/legal-entities", success: 200, deny: 403 },
    { route: "leave/balances", method: "POST", own: "ownLeavePolicy",
      prefix: "/api/leave/balances", success: 201, deny: 403 },
    { route: "self/payslips/[id]", method: "GET", own: "ownPayslipPdf",
      prefix: "/api/self/payslips/", success: 200, deny: 404 },
    { route: "self/payslips", method: "GET", own: "ownSelfService",
      prefix: "/api/self/payslips", success: 200, deny: null },
  ];
  for (const spec of cases) {
    const path = "src/app/api/" + spec.route + "/route.ts";
    const method = manifest.allApiRouteFiles[path]?.methods.find((m) => m.name === spec.method);
    assert.equal(method?.status, "COVERED", path + " " + spec.method + " must retain own/victim proof");
    const proof = method.testedBy;
    assert.equal(proof?.file, "scripts/qa/tenant-second-pass-http.mjs");
    const own = evidenceLine(proof.file, proof.ownPositiveLine, path + " own");
    const negative = evidenceLine(proof.file, proof.foreignDenialLine, path + " foreign");
    const ownSpan = source.slice(proof.ownPositiveLine - 1, proof.ownPositiveLine + 7).join("\n");
    const denySpan = source.slice(proof.foreignDenialLine - 1, proof.foreignDenialLine + 5).join("\n");
    assert.ok(own.includes("const " + spec.own + " = expectStatus") &&
      own.includes(spec.prefix) && ownSpan.includes("), " + spec.success + ","),
      path + ": positive proof requires the exact route and successful method");
    if (spec.deny !== null) {
      assert.ok(negative.includes("expectStatus(await request(") &&
        negative.includes(spec.prefix) && denySpan.includes("), " + spec.deny + ","),
        path + ": denial must use the exact route and status");
    } else {
      assert.ok(negative.includes("ownOnly(ownSelfService.json?.payslips") &&
        denySpan.includes("victimEntry.id") && denySpan.includes("coworkerEntry.id"),
        "Self-service list requires non-empty own entry and exclusion of victim and coworker");
      assert.match(ownSpan, /victim\.id/,
        "Self-service scope must ignore a forged client-supplied victim organizationId");
    }
    if (spec.method === "POST") {
      const invariant = evidenceLine(proof.file, proof.unchangedDbLine, "leave policy invariant");
      assert.match(invariant, /assert\.deepEqual\(victimLeavePoliciesAfter, victimLeavePoliciesBefore/,
        "Mutating proof requires actual unchanged victim PostgreSQL rows");
    }
  }
  const script = source.join("\n");
  assert.match(script, /for \(const idx of \[1, 2\]\)/,
    "Both independent attacker sessions must exercise these methods");
  assert.match(script, /"SYNTHETIC-COWORKER-PRIVATE-"/,
    "Same-employer employee-level isolation requires a separately seeded coworker document");
  assert.match(script, /employeeCookie[\s\S]*coworkerEntry\.id/,
    "Employee role must deny same-employer coworker payslip");
  assert.match(script, /"payroll register"/,
    "Employee role must not open privileged payroll registers");
  assert.match(script, /await verifySensitiveTenantDownloadsAndRoles\(f\)/,
    "Standalone uncalled helper is not executable evidence");
});


test("self-service PDF cannot outlive former-employer membership", () => {
  // Integrity checks only: the real-HTTP and unchanged-DB proof runs through
  // the existing three-employer Security HTTP Smoke CI, not mocked checks.
  const route = "src/app/api/self/payslips/[id]/route.ts";
  const method = manifest.allApiRouteFiles[route].methods.find((m) => m.name === "GET");
  assert.equal(method?.status, "COVERED");
  const source = readFileSync(route, "utf8");
  const guardCall = "const membershipDenied = await assertMembership(session.id, employee.organizationId);";
  assert.match(source, /import \{ assertMembership \} from "@\/lib\/access";/);
  const guardAt = source.indexOf(guardCall);
  assert.ok(guardAt > source.indexOf("if (!employee) return Response.json"),
    "Guard must use the actual employee's employer");
  assert.ok(guardAt < source.indexOf("db.select().from(organizations)") &&
    guardAt < source.indexOf("renderPayslipPdf("),
    "Active employer grant must be checked before loading identity or returning PDF bytes");
  assert.ok(source.slice(guardAt, guardAt + 240).includes("if (membershipDenied) return membershipDenied;"));
  assert.equal(source.split("\n")[method.testedBy.currentMembershipGuardLine - 1].trim(), guardCall);
  assert.equal(method.testedBy.file, "scripts/qa/tenant-second-pass-http.mjs");
  const own = evidenceLine(method.testedBy.file, method.testedBy.ownPositiveLine,
    "Audit own Released PDF");
  assert.ok(own.includes("const ownPayslipPdf = expectStatus") && own.includes("/api/self/payslips/"),
    "Audit employee must actually receive own employer's PDF");
  const mainOwn = evidenceLine(method.testedBy.file, method.testedBy.staleMembershipOwnPositiveLine,
    "Canonical merged #1283 own PDF");
  assert.ok(mainOwn.includes('const ownedPdf = expectStatus(await request("/api/self/payslips/" + ownEntry.id'),
    "Use canonical merged #1283 own-payroll positive, not a placeholder");
  const scriptLines = readFileSync(method.testedBy.file, "utf8").split("\n");
  const ownSpan = scriptLines.slice(method.testedBy.staleMembershipOwnPositiveLine - 1,
    method.testedBy.staleMembershipOwnPositiveLine + 6).join("\n");
  assert.ok(ownSpan.includes("cookie: employeeCookie") &&
    ownSpan.includes("}), 200,") && ownSpan.includes("%PDF-"),
    "Canonical positive control must contain real PDF bytes with exact 200");
  const live = evidenceLine(method.testedBy.file, method.testedBy.staleSessionOwnPositiveLine,
    "Same still-signed-in employee account after employer change");
  assert.ok(live.includes('const stillSignedIn = expectStatus(await request("/api/account"'),
    "The same session must authenticate after old employer membership revocation");
  const negative = evidenceLine(method.testedBy.file, method.testedBy.staleMembershipForeignDenialLine,
    "Former-employer PDF denial");
  assert.ok(negative.includes('const revokedPdf = expectStatus(await request("/api/self/payslips/" + ownEntry.id'),
    "Revoked-member negative control must target the exact previously readable PDF");
  const negSpan = scriptLines.slice(method.testedBy.staleMembershipForeignDenialLine - 1,
    method.testedBy.staleMembershipForeignDenialLine + 4).join("\n");
  assert.ok(negSpan.includes("cookie: employeeCookie") && negSpan.includes("}), 403,"),
    "Denial must be exact 403; anonymous 401 and made-up 404 do not qualify");
  const invariant = evidenceLine(method.testedBy.file,
    method.testedBy.staleMembershipUnchangedDbLine, "Unchanged old payroll after denial");
  assert.match(invariant, /assert\.deepEqual\(afterDeniedPdf, beforeDeniedPdf/,
    "Denied PDF must leave the old employer payroll row unchanged");
  const script = scriptLines.join("\n");
  assert.match(script, /assert\.equal\(revoked\?\.active, false,/,
    "Actually revoke original employer membership in disposable PostgreSQL");
  assert.match(script, /assert\.equal\(stillMember\?\.active, true,/,
    "Keep new employer membership active so a logged-out 401 cannot false-pass");
  assert.match(script, /assert\.equal\(stillSignedIn\.json\?\.profile\?\.id, essUser\.id,/,
    "Post-revocation 200 must belong to the same employee account");
  assert.ok(script.indexOf("const ownedPdf = expectStatus") <
      script.indexOf("await db.update(userOrganizations).set({ active: false })") &&
      script.indexOf("await db.update(userOrganizations).set({ active: false })") <
      script.indexOf("const revokedPdf = expectStatus"),
    "The real own PDF must precede actual revocation, then be denied");
  assert.match(script, /await verifyRevokedEmployerPayslipAccess\(f\)/,
    "Canonical merged #1283 regression must run, not merely be defined");
  assert.match(script, /await verifySensitiveTenantDownloadsAndRoles\(f\)/,
    "Additional audit method-level proofs must continue running");
});

test("all credited proof links point to the claimed route and every recertified write has controls", () => {
  const source = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8").split("\n");
  for (const [path, entry] of Object.entries(manifest.allApiRouteFiles)) {
    const routeFragments = ("/api/" + entry.route).split(/\[[^\]]+\]/).filter(Boolean);
    for (const method of entry.methods) {
      if (method.status !== "COVERED") continue;
      const proof = method.testedBy;
      if (proof?.file === "scripts/qa/underpayment-posting-http.mjs") {
        assert.equal(path, "src/app/api/payroll-underpayments/route.ts");
        const spec = { POST: [136, 149], PATCH: [166, 155] }[method.name];
        assert.ok(spec, "Only the two executed underpayment writes receive new credit");
        assert.deepEqual([proof.ownPositiveLine, proof.foreignDenialLine], spec);
        const lines = readableLines(proof.file);
        assert.ok(lines[spec[0] - 1].includes(method.name === "POST" ? "status(await request" : "const winner = replies.find"));
        assert.match(lines[spec[1] - 1], /await deny\(v,/);
        assert.match(lines[spec[1] - 1], /v\.org\.id/);
        assert.match(lines[proof.unchangedDbLine - 1], /assert\.deepEqual\(await snapshot\(v\), before/);
        const integration = lines.join("\n");
        assert.match(integration, /await journey\(v, a\); await journey\(v, b\)/);
        assert.match(integration, /v\.claim\.id > Math\.max\(a\.claim\.id, b\.claim\.id, 6\)/);
        assert.match(integration, /\[200, 409\]/);
        const workflow = readFileSync(".github/workflows/underpayment-posting.yml", "utf8");
        assert.match(workflow, /posting: \['false', 'true'\]/);
        assert.match(workflow, /MONEY_PROOF_TRANSPORT: http/);
        assert.match(workflow, /npx tsx scripts\/qa\/underpayment-posting-http\.mjs/);
        continue;
      }
      if (proof?.file === "scripts/qa/tenant-money-lifecycle-http.mjs") {
        // Bookkeeping for eight separately executed PG16/HTTP cases; this
        // source guard never substitutes for the required workflow receipt.
        const specs = {
          "GET holidays": [190, 192], "POST holidays": [177, 193],
          "PATCH holidays": [196, 194], "DELETE holidays": [199, 195],
          "GET payroll-earnings": [134, 136], "POST payroll-earnings": [179, 137],
          "PATCH payroll-earnings": [140, 139], "POST payroll-runs/[id]/process": [263, 259],
        };
        const spec = specs[method.name + " " + entry.route];
        assert.ok(spec, path + ": unrelated methods cannot borrow money-path proof");
        assert.deepEqual([proof.line, proof.ownPositiveLine, proof.foreignDenialLine,
          proof.forgedSelectorLine, proof.unchangedDbLine], [spec[0], spec[0], spec[1], spec[1], 126]);
        const integration = readFileSync(proof.file, "utf8");
        const lines = integration.split("\n");
        const own = lines.slice(spec[0] - 1, spec[0] + 2).join("\n");
        const foreign = lines[spec[1] - 1];
        assert.match(own, /status\(await request\(/);
        assert.match(foreign, /await deny\(v, a\.maker/);
        assert.match(foreign, /403,/);
        assert.match(foreign, /v\.(?:org|earning|holiday|run)\./);
        if (entry.route === "payroll-runs/[id]/process") {
          assert.match(own, /\/process/);
          assert.match(integration, /for \(const suffix of \["process", "submit-review", "release"\]\)/);
        } else {
          assert.ok(own.includes("/api/" + entry.route) && foreign.includes("/api/" + entry.route));
        }
        if (method.name !== "GET") {
          assert.ok(own.includes('"' + method.name + '"') && foreign.includes('"' + method.name + '"'));
        }
        assert.match(lines[125], /assert\.deepEqual\(await snapshot\(v\), before/);
        assert.match(integration, /for \(const attacker of \[a, b\]\)/);
        assert.match(integration, /victim earning\/correction IDs exceed both attacker IDs and 6/);
        const workflow = readFileSync(".github/workflows/tenant-money-lifecycle.yml", "utf8");
        assert.match(workflow, /exact-links: \['false', 'true'\]/);
        assert.match(workflow, /MONEY_PROOF_TRANSPORT: http/);
        assert.match(workflow, /npx tsx scripts\/qa\/tenant-money-lifecycle-http\.mjs/);
        assert.match(integration, /assert\.notEqual\(process\.env\.GITHUB_ACTIONS, "true"/);
        continue;
      }
      // New method credits must be bound to an explicitly reviewed endpoint,
      // real two-attacker HTTP runner, exact request/status lines, and a
      // persisted victim-before/after assertion for mutating methods. Do not
      // generalize this exemption to arbitrary new test files or methods.
      const newTenantProofTargets = {
        "scripts/qa/compliance-read-sweep-http.mjs": new Set([
          "src/app/api/bir/annual-employer/module-evidence/route.ts",
          "src/app/api/compliance/dole-13th-month/route.ts",
          "src/app/api/compliance/government-loan-remittances/route.ts",
          "src/app/api/compliance/statutory-remittances/payment-evidence/route.ts",
        ]),
        "scripts/qa/hcm-probation-sweep-http.mjs": new Set([
          "src/app/api/hcm/probation-reviews/route.ts",
        ]),
      };
      if (Object.hasOwn(newTenantProofTargets, proof?.file)) {
        assert.ok(newTenantProofTargets[proof.file].has(path),
          path + ": new proof source is restricted to its reviewed API routes");
        const integration = readFileSync(proof.file, "utf8");
        const runner = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
        const entrypoint = proof.file.includes("compliance-read")
          ? "verifyComplianceReadSweep" : "verifyHcmProbationSweep";
        assert.ok(runner.includes(entrypoint + "(f, { request, expectStatus })"),
          path + ": new real-HTTP suite must execute inside the disposable guarded runner");
        assert.match(integration, /process\.env\.CI\s*!==\s*"true"/);
        assert.match(integration, /process\.env\.TENANT_SECOND_PASS_MODE/);
        assert.match(integration, /for\s*\(\s*const idx of \[1,\s*2\]\s*\)/,
          path + ": two independent real-employer attacker principals required");
        const proofLines = integration.split("\n");
        function completeRequest(lineNumber, expectedLabel) {
          assert.ok(Number.isInteger(lineNumber) && lineNumber > 0 &&
            lineNumber <= proofLines.length, path + ": invalid " + expectedLabel + " location");
          const at = lineNumber - 1;
          const searchStart = Math.max(0, at - 12);
          const candidates = proofLines.slice(searchStart, at + 1);
          const offset = candidates.findLastIndex((line) =>
            /expectStatus\s*\(\s*await request(?:Multipart)?\s*\(/.test(line));
          assert.ok(offset >= 0, path + ": missing actual " + expectedLabel + " HTTP call");
          const requestStart = searchStart + offset;
          const statusEnd = proofLines.findIndex((line, i) =>
            i >= requestStart && i <= requestStart + 15 &&
            /(?:\)\s*,\s*|^\s*)\d{3}\s*,/.test(line));
          assert.ok(statusEnd >= requestStart,
            path + ": " + expectedLabel + " must assert a real HTTP status");
          if (expectedLabel === "foreign-denial") {
            assert.equal(statusEnd, at,
              path + ": foreign-denial pointer must be the exact status assertion");
          } else {
            assert.equal(requestStart, at,
              path + ": own-positive pointer must be the exact request start");
          }
          return {
            start: proofLines[requestStart],
            throughStatus: proofLines.slice(requestStart, statusEnd + 1).join("\n"),
          };
        }
        const own = completeRequest(proof.ownPositiveLine, "own-positive");
        const foreign = completeRequest(proof.foreignDenialLine, "foreign-denial");
        assert.match(own.start, /expectStatus\s*\(\s*await request(?:Multipart)?\s*\(/);
        assert.match(proofLines[proof.ownPositiveLine - 1], /expectStatus\s*\(\s*await request(?:Multipart)?\s*\(/,
          path + ": ownPositiveLine must be the request itself, never a nearby assertion");
        assert.match(proofLines[proof.foreignDenialLine - 1], /(?:\)\s*,\s*|^\s*)403\s*,/,
          path + ": foreignDenialLine must assert an actual forbidden response");
        const isMultipart = path ===
          "src/app/api/compliance/statutory-remittances/payment-evidence/route.ts" &&
          method.name === "POST";
        const endpoint = "/api/" + entry.route;
        if (isMultipart) {
          assert.match(own.throughStatus, /requestMultipart\s*\(\s*cookie/);
          assert.match(foreign.throughStatus, /requestMultipart\s*\(\s*cookie/);
          assert.ok(integration.includes('new URL("' + endpoint + '"') &&
            integration.includes('method: "POST"'),
            path + ": multipart request must really POST to the tested route");
        } else {
          assert.ok(own.throughStatus.includes(endpoint) &&
            foreign.throughStatus.includes(endpoint),
            path + ": both signed-in proof calls must target the claimed endpoint");
          if (method.name !== "GET") {
            assert.ok(own.throughStatus.includes('method: "' + method.name + '"') &&
              foreign.throughStatus.includes('method: "' + method.name + '"'),
              path + ": positive and foreign denial must exercise the claimed method");
          }
        }
        const ownStatus = path === "src/app/api/hcm/probation-reviews/route.ts" &&
          method.name === "POST" || isMultipart ? 201 : 200;
        const assertedOwnStatus = own.throughStatus.match(/(?:\)\s*,\s*|^\s*)(\d{3})\s*,/m);
        assert.equal(Number(assertedOwnStatus?.[1]), ownStatus,
          path + ": valid own-employer HTTP success is mandatory");
        assert.match(own.throughStatus, /own\.id/,
          path + ": positive request must select an actual own employer");
        assert.match(foreign.throughStatus, /victim\.id/,
          path + ": foreign denial must target real victim employer");
        if (method.name !== "GET") {
          const invariant = evidenceLine(proof.file, proof.unchangedDbLine,
            path + " victim persistence invariant");
          assert.match(invariant, /assert\.deepEqual\(\s*(?:victim|officialVictim|storedVictim)/,
            path + ": an unchanged victim database snapshot is mandatory for writes");
        }
        continue;
      }
      if (proof?.file === "scripts/qa/tenant-dl01-vault-http.mjs") {
        const spec = method.name === "GET" && path === "src/app/api/employee-vault/route.ts"
          ? { own: 128, foreign: 132, forged: 138, ownStatus: 200, forgedStatus: 200 }
          : method.name === "DELETE" && path === "src/app/api/employee-vault/[id]/route.ts"
            ? { own: 148, foreign: 144, forged: 160, ownStatus: 204, forgedStatus: 204 }
            : null;
        assert.ok(spec, path + ": no unrelated API may borrow provisional vault evidence");
        const suite = readFileSync(proof.file, "utf8").split("\n");
        const span = l => suite.slice(l - 1, l + 4).join("\n");
        assert.equal(proof.line, spec.own);
        assert.equal(proof.ownPositiveLine, spec.own);
        assert.equal(proof.foreignDenialLine, spec.foreign);
        assert.equal(proof.forgedSelectorLine, spec.forged);
        assert.equal(proof.unchangedDbLine, 173);
        assert.equal(proof.victimExistsLine, 110);
        assert.equal(proof.victimIdOrderingLine, 104);
        assert.match(span(spec.own), /expectStatus\(await request\(/);
        assert.ok(span(spec.own).includes("), " + spec.ownStatus + ","));
        assert.match(span(spec.foreign), /expectStatus\(await request\(/);
        assert.match(span(spec.foreign), /\), 403,/);
        assert.match(span(spec.forged), /expectStatus\(await request\(/);
        assert.ok(span(spec.forged).includes("), " + spec.forgedStatus + ","));
        assert.match(suite[109], /persistedVictimDoc\?\.organizationId, victimOrg\.id/);
        assert.match(span(104), /victimDoc\.id > created\[2\]\[1\]\.id/);
        assert.match(suite[172], /assert\.deepEqual\(await victimSnapshot\(victimOrg\.id\), before/);
        assert.match(source.join("\n"), /verifyDl01Vault\(f, \{ request, expectStatus \}\)/);
        assert.match(source.join("\n"), /TENANT_DL01_VAULT_PROOF === "isolated-ci-only"/);
        assert.match(suite.join("\n"), /TENANT_SECOND_PASS_MODE, "isolated-ci-only"/);
        assert.match(suite.join("\n"), /for \(const idx of \[1, 2\]\)/);
        assert.match(suite.join("\n"), /vault-removed:/);
        const smoke = readFileSync(".github/workflows/security-http-smoke.yml", "utf8");
        assert.match(smoke, /TENANT_DL01_VAULT_PROOF: isolated-ci-only/);
        assert.match(smoke, /EMPLOYEE_DOCUMENT_VAULT_ENABLED: "true"/);
        continue;
      }
      assert.ok(["scripts/qa/tenant-second-pass-http.mjs", "scripts/qa/payroll-approved-exit-http.mjs",
        "scripts/qa/payroll-read-sweep-http.mjs", "scripts/qa/bank-tenant-http.mjs",
        "scripts/qa/pr-1302-tenant-proof.mjs",
        "scripts/qa/salary-correction-case-tenant-proof.mjs",
        "scripts/qa/workforce-attendance-sweep-http.mjs",
        "scripts/qa/hcm-work-queue-http.mjs",
        "scripts/qa/tenant-manifest-driven-http.mjs", "scripts/qa/tenant-high-risk-01-http.mjs",
        "scripts/qa/tenant-dl01-import-history-http.mjs", "scripts/qa/tenant-dl01-filing-file-http.mjs",
        "scripts/qa/tenant-dl02-http.mjs", "scripts/qa/government-loan-read-http.mjs", "scripts/qa/dole-13th-month-http.mjs", "scripts/qa/tenant-dl01-batch2-http.mjs"].includes(proof?.file),
        path + " " + method.name + ": unsupported evidence source");
      if (["scripts/qa/tenant-dl01-import-history-http.mjs", "scripts/qa/tenant-dl01-filing-file-http.mjs"].includes(proof.file)) {
        const history = proof.file.endsWith("tenant-dl01-import-history-http.mjs");
        const route = history ? "employees/import" : "compliance/filing-validations/[id]/file";
        const key = "GET " + route;
        assert.equal(path, "src/app/api/" + route + "/route.ts", "No unrelated method may borrow DL-01 proof");
        assert.equal(method.name, "GET", "Read proof cannot certify a mutation");
        const declaration = history ? 'export const IMPORT_HISTORY_METHOD = "GET employees/import";' : 'export const FILING_FILE_METHOD = "GET compliance/filing-validations/[id]/file";';
        const suite = readFileSync(proof.file, "utf8");
        const lines = suite.split("\n");
        const pins = {
          line: declaration,
          ownPositiveLine: "const own = expectStatus(await request(",
          foreignDenialLine: "const foreign = expectStatus(await request(",
          forgedSelectorLine: history ? "const ignored = expectStatus(await request(" : "const forged = expectStatus(await request(",
          unchangedDbLine: "assert.deepEqual(after, before,",
          victimExistsLine: "assert.equal(persistedVictim?.organizationId, victimOrg.id)",
          victimIdOrderingLine: history ? "assert.ok(victim.id > 6 && victim.id > rows[8].id && victim.id > rows[9].id)" : "assert.ok(victim.record.id > 6 && victim.record.id > fixtures[7].record.id && victim.record.id > fixtures[8].record.id)",
        };
        for (const [field, fragment] of Object.entries(pins)) {
          assert.ok(evidenceLine(proof.file, proof[field], key + " " + field).trimStart().startsWith(fragment), key + " incorrect " + field);
        }
        const span = field => lines.slice(proof[field] - 1, proof[field] + 3).join("\n");
        assert.ok(span("ownPositiveLine").includes("), 200,"));
        assert.ok(span("foreignDenialLine").includes("), 403,"));
        assert.ok(proof.ownPositiveLine < proof.foreignDenialLine && proof.foreignDenialLine < proof.forgedSelectorLine);
        assert.ok(proof.forgedSelectorLine < proof.unchangedDbLine);
        assert.ok(suite.includes(history ? "assertOwnHistory(own, ownOrg.id, owned, victim)" : "assertOwnedFilingBytes(own, owned)"));
        assert.ok(suite.includes(history ? "assertOwnHistory(ignored, ownOrg.id, owned, victim)" : "assertOwnedFilingBytes(forged, owned)"));
        const snapshot = history ? "snapshotVictimImportHistory" : "snapshotVictimFilings";
        assert.ok(suite.includes("const before = await " + snapshot + "(victimOrg.id)"));
        assert.ok(suite.includes("const after = await " + snapshot + "(victimOrg.id)"));
        assert.ok(suite.includes('process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only"'));
        assert.ok(suite.includes('process.env.SECURITY_SMOKE_URL, "http://127.0.0.1:3000"'));
        assert.ok(suite.includes("for (const idx of [1, 2])"));
        assert.ok(suite.includes("assert.equal(receipts.length, 2)"));
        const hook = readFileSync("scripts/qa/tenant-static-template-http.mjs", "utf8");
        const fn = history ? "verifyTenantImportHistory" : "verifyTenantFilingFile";
        assert.ok(hook.includes("await " + fn + "(f, { request, expectStatus });"));
        assert.ok(source.join("\n").includes("verifyTenantIndependentImportTemplate(f, { request, expectStatus })"));
        continue;
      }
      if (proof.file === "scripts/qa/tenant-dl01-batch2-http.mjs") {
        // Newly credited DL-01 batch 2 claims require distinct same-method
        // live PG16/HTTP evidence, never a method name borrowed from a source
        // guard, 401/404-only negative or a previously covered employee export.
        const key = method.name + " " + entry.route;
        const spec = {
          "POST compliance/statutory-remittances/posting-import": ["ownPosting", "foreignPosting", "forgedPosting", "persistedVictimBatch", "victimBatch.id > batches[idx].id", 404],
          "GET compliance/contribution-issues/evidence": ["ownCase", "foreignCase", "forgedCase", "persistedVictimCase", "victimCase.id > cases[idx].id", 200],
          "GET compliance/labor-inspection/evidence-pack": ["ownInspection", "foreignInspection", "forgedInspection", "persistedVictimWorker", "victimExportWorker.id > f.ownedEmployees[0].id", 200],
          "GET bi-exports": ["ownBi", "foreignBi", "forgedBi", "persistedVictimBiRun", "victimBiRun.id > f.ownRuns[1].id", 400],
        }[key];
        assert.ok(spec, key + ": no unreviewed method may borrow batch-2 proofs");
        const [ownName, foreignName, forgedName, victimName, ordering, forgedStatus] = spec;
        const suite = readFileSync(proof.file, "utf8");
        const lines = suite.split("\n");
        const actual = field => evidenceLine(proof.file, proof[field], key + " " + field);
        const span = field => lines.slice(proof[field] - 1, proof[field] + 12).join("\n");
        assert.ok(actual("line").includes('"' + key + '"'), key + ": wrong adapter declaration");
        assert.ok(actual("ownPositiveLine").includes("const " + ownName + " = expectStatus(await request(") &&
          span("ownPositiveLine").includes("}), 200,"), key + ": real populated own response required");
        assert.ok(actual("foreignDenialLine").includes("const " + foreignName + " = expectStatus(await request(") &&
          span("foreignDenialLine").includes("}), 403,"), key + ": real victim tenant 403 required");
        assert.ok(actual("forgedSelectorLine").includes("const " + forgedName + " = expectStatus(await request(") &&
          span("forgedSelectorLine").includes("}), " + forgedStatus + ","), key + ": forged victim selector is unverified");
        assert.ok(actual("victimExistsLine").includes("assert.equal(" + victimName),
          key + ": real persisted victim row must be checked");
        assert.ok(actual("victimIdOrderingLine").trimStart().startsWith("assert.ok(") &&
          span("victimIdOrderingLine").includes(ordering),
          key + ": victim IDs must exceed real attacker-owned objects");
        assert.match(actual("unchangedDbLine"), /assert\.deepEqual\(after, before,/);
        assert.ok(proof.ownPositiveLine < proof.foreignDenialLine &&
          proof.foreignDenialLine < proof.forgedSelectorLine &&
          proof.forgedSelectorLine < proof.unchangedDbLine);
        assert.ok(suite.includes('assert.equal(process.env.CI, "true")') &&
          suite.includes('assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only")') &&
          suite.includes('assert.equal(app.href, "http://127.0.0.1:3000/")') &&
          suite.includes("for (const idx of [1, 2])") &&
          suite.includes("const before = await victimSnapshot(victimOrg.id)") &&
          suite.includes("const after = await victimSnapshot(victimOrg.id)") &&
          suite.includes('assert.equal(receipts.length, 2, "Both independent attackers must execute every real method")'), key + ": guarded real HTTP harness required");
        assert.ok(source.join("\n").includes('verifyDl01Batch2(f, { request, expectStatus })'),
          key + ": method-specific source must run inside existing protected HTTP runner");
        if (method.name === "POST") {
          assert.match(suite, /assert\.equal\(ownPosting\.json\?\.applied, true\)/);
          assert.match(suite, /assert\.equal\(artifact\?\.outcome, "applied"\)/);
          assert.match(suite, /assert\.equal\(Buffer\.from\(artifact\.fileDataBase64, "base64"\)\.toString\("utf8"\), csv\)/);
        }
        continue;
      }
      if (proof.file === "scripts/qa/tenant-manifest-driven-http.mjs") {
        // The manifest-driven runner uses shared request(urls.own/foreign) lines:
        // those lines do not repeat literal /api paths. Validate the *specific*
        // route adapter and its executable real-HTTP proof instead of relaxing
        // the generic guard for ordinary source-pinned method assertions.
        const key = method.name + " " + entry.route;
        assert.ok(new Set([
          "GET compliance/statutory-remittances/payment-evidence/[id]",
          "GET compliance/statutory-remittances/payment-evidence",
          "GET compliance/statutory-remittances/posting-evidence/[id]",
          "POST compliance/statutory-remittances/payment-evidence",
        ]).has(key), path + " " + method.name + ": unreviewed table-driven credit");
        const suite = readFileSync(proof.file, "utf8");
        const runner = source.join("\n");
        assert.match(runner,
          /await \(await import\("\.\/tenant-manifest-driven-http\.mjs"\)\)\.verifyManifestDrivenStatutoryBatch\(f, \{ request, expectStatus, makeSession \}\)/,
          key + ": proof must execute inside the isolated PostgreSQL HTTP harness");
        assert.match(suite, /process\.env\.TENANT_SECOND_PASS_MODE, "isolated-ci-only"/);
        if (key === "POST compliance/statutory-remittances/payment-evidence") {
          const owned = evidenceLine(proof.file, proof.ownPositiveLine, key + " owned upload");
          const denied = evidenceLine(proof.file, proof.foreignDenialLine, key + " foreign denial");
          const unchanged = evidenceLine(proof.file, proof.unchangedDbLine, key + " victim unchanged");
          assert.match(owned, /const ownUpload = expectStatus\(await request\("/);
          assert.match(denied, /const foreignUpload = expectStatus\(await request\("/);
          const proofLines = suite.split("\n");
          const ownSpan = proofLines.slice(proof.ownPositiveLine - 1, proof.ownPositiveLine + 3).join("\n");
          const deniedSpan = proofLines.slice(proof.foreignDenialLine - 1, proof.foreignDenialLine + 3).join("\n");
          assert.match(ownSpan, /method: "POST", cookie: privileged\.cookie, form: proofForm\(ownOrg\.id, ownedBatch\.id\)/);
          assert.match(ownSpan, /\}\), 201,/);
          assert.match(deniedSpan, /method: "POST", cookie: privileged\.cookie, form: proofForm\(victimOrg\.id, victimBatch\.id\)/);
          assert.match(deniedSpan, /\}\), 403,/);
          assert.match(unchanged, /assert\.deepEqual\(after, before,/);
          assert.match(suite, /const contenders = await Promise\.all\(\["race-a", "race-b", "race-c", "race-d"\]/);
          assert.match(suite, /assert\.equal\(activeAfterRace\.length, 1/);
          continue; // Explicit own/foreign mutation and unchanged-DB proof; no generic bypass.
        }
        const adapter = evidenceLine(proof.file, proof.line, key + " adapter");
        assert.ok(adapter.includes(JSON.stringify(key) + ": {"),
          key + ": pinned case does not match credited method");
        const start = suite.indexOf(adapter);
        const next = suite.indexOf("\n  },", start + adapter.length);
        const registryEnd = suite.indexOf("\n});\nexport const FIRST_ADAPTED_METHODS", start);
        assert.ok(registryEnd > start, key + ": registry boundary missing");
        const caseSource = suite.slice(start, next < 0 ? registryEnd : next);
        const urlPath = "/api/" + entry.route.replace(/\[[^\]]+\]/g, "");
        assert.equal(caseSource.split(urlPath).length - 1, 2,
          key + ": adapter must name actual own and victim HTTP paths");
        assert.match(caseSource, /denial: 403/,
          key + ": foreign employer denial must be exact 403");
        assert.match(evidenceLine(proof.file, proof.ownPositiveLine, key + " own"),
          /const own = expectStatus\(await request\(urls\.own, \{ cookie \}\), 200,/);
        assert.match(evidenceLine(proof.file, proof.foreignDenialLine, key + " victim"),
          /const foreign = expectStatus\(await request\(urls\.foreign, \{ cookie \}\), adapter\.denial,/);
        const forged = evidenceLine(proof.file, proof.forgedSelectorLine, key + " forged selector");
        const expectedForged = key.endsWith("/posting-evidence/[id]")
          ? "const forged = expectStatus(await request("
          : key.endsWith("/payment-evidence/[id]")
            ? "const crossId = expectStatus(await request("
            : "const filtered = expectStatus(await request(";
        assert.ok(forged.includes(expectedForged),
          key + ": real foreign identifier must be tested under own employer");
        assert.match(evidenceLine(proof.file, proof.unchangedDbLine, key + " victim unchanged"),
          /assert\.deepEqual\(after, before,/);
        assert.match(suite, /for \(const idx of \[1, 2\]\)/,
          key + ": both independent attacker sessions required");
        assert.match(suite, /const before = await snapshotVictim\(victimOrg\.id\)/);
        assert.match(suite, /const after = await snapshotVictim\(victimOrg\.id\)/);
        continue;
      }
      if (proof.file === "scripts/qa/salary-correction-case-tenant-proof.mjs") {
        assert.equal(path, "src/app/api/hcm/salary-corrections/cases/route.ts",
          path + ": only the #641 cases endpoint may cite this source");
      }
      if (proof.file === "scripts/qa/payroll-read-sweep-http.mjs") {
        const harness = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
        const integration = readFileSync(proof.file, "utf8");
        assert.match(harness, /await \(await import\("\.\/payroll-read-sweep-http\.mjs"\)\)\.verifyPayrollReadSweep\(f, \{ request, expectStatus \}\)/,
          path + ": added evidence suite must execute inside the guarded isolated HTTP harness");
        assert.match(integration, /assert\.deepEqual\(after, before/,
          path + ": denied requests must leave real victim data unchanged");
        assert.match(integration, /process\.env\.TENANT_SECOND_PASS_MODE/,
          path + ": isolated-only guard is mandatory");
      }
      if (proof.file === "scripts/qa/workforce-attendance-sweep-http.mjs") {
        const runner=readFileSync("scripts/qa/tenant-second-pass-http.mjs","utf8");
        const suite=readFileSync(proof.file,"utf8");
        assert.match(runner,/verifyWorkforceAttendanceSweep\(f,\{request,expectStatus\}\)/,
          "Attendance proof must execute from protected real-HTTP PostgreSQL16 harness");
        assert.match(suite,/process\.env\.TENANT_SECOND_PASS_MODE/);
        assert.match(suite,/assert\.deepEqual\(victimEventsAfter,victimEventsBefore/);
        assert.match(suite,/assert\.deepEqual\(victimPoliciesAfter,victimPoliciesBefore/);
        assert.match(suite,/assert\.deepEqual\(victimLocksAfter,victimLocksBefore/);
      }
      if (proof.file === "scripts/qa/hcm-work-queue-http.mjs") {
        assert.ok(["src/app/api/hcm/business-processes/inbox/route.ts",
          "src/app/api/hcm/lifecycle-notifications/route.ts"].includes(path),
          path + ": only the two HCM endpoints with real proof may cite this source");
        const runner = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
        const suite = readFileSync(proof.file, "utf8");
        assert.match(runner, /verifyHcmWorkQueueIsolation\(f, \{ request, expectStatus \}\)/);
        assert.match(suite, /process\.env\.TENANT_SECOND_PASS_MODE/);
        assert.match(suite, /assert\.deepEqual\(victimStepsAfter,victimStepsBefore/);
        assert.match(suite, /assert\.deepEqual\(victimTasksAfter,victimTasksBefore/);
        assert.equal(proof.ownStatus, 200);
        assert.equal(proof.foreignStatus, 403);
      }
      if (proof.file === "scripts/qa/government-loan-read-http.mjs") {
        assert.equal(path, "src/app/api/compliance/government-loan-remittances/route.ts",
          "Only the source-pinned government loan GET/POST methods may use this proof");
        const runner = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
        const suite = readFileSync(proof.file, "utf8");
        assert.match(runner, /verifyGovernmentLoanRemittanceIsolation\(f, \{ request, expectStatus \}\)/);
        assert.match(suite, /process\.env\.TENANT_SECOND_PASS_MODE/);
        assert.match(suite, /assert\.deepEqual\(afterBatches,beforeBatches/);
        assert.match(suite, /assert\.deepEqual\(afterMembers,beforeMembers/);
        assert.equal(proof.ownStatus, 200);
        assert.equal(proof.foreignStatus, 403);
      }
      if (proof.file === "scripts/qa/dole-13th-month-http.mjs") {
        assert.equal(path, "src/app/api/compliance/dole-13th-month/route.ts",
          "Only DOLE GET/POST may cite single-employer owned/foreign proof");
        assert.ok(["GET", "POST"].includes(method.name));
        const runner = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
        const suite = readFileSync(proof.file, "utf8");
        const lines = suite.split("\n");
        assert.match(runner, /verifyDoleReportTenantIsolation\(f, \{ request, expectStatus \}\)/,
          "DOLE must execute within protected disposable real-HTTP harness");
        assert.match(suite, /process\.env\.TENANT_SECOND_PASS_MODE/);
        assert.match(suite, /victimProfilesBefore\.length > 0 && victimSubmissionsBefore\.length > 0/,
          "Victim evidence must be genuinely seeded and non-empty");
        assert.match(lines[proof.ownPositiveLine - 1], /expectStatus\(await request\("\/api\/compliance\/dole-13th-month/);
        assert.match(lines[proof.foreignDenialLine - 1], /expectStatus\(await request\(/);
        const ownSpan = lines.slice(proof.ownPositiveLine - 1, proof.ownPositiveLine + 9).join("\n");
        const foreignSpan = lines.slice(proof.foreignDenialLine - 1, proof.foreignDenialLine + 10).join("\n");
        assert.match(ownSpan, /\), 200,/, "The owned GET/POST must actually succeed");
        assert.match(foreignSpan, /\), 403,/, "The actual victim GET/POST must deny");
        if (method.name === "POST")
          assert.match(lines[proof.unchangedDbLine - 1], /assert\.deepEqual\(victimProfilesAfter, victimProfilesBefore/);
        assert.match(suite, /assert\.deepEqual\(victimSubmissionsAfter, victimSubmissionsBefore/);
      }
      if (proof.file === "scripts/qa/bank-tenant-http.mjs") {
        assert.match(readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8"),
          /await \(await import\("\.\/bank-tenant-http\.mjs"\)\)\.verifyBankTenantIsolation\(f, \{ request, expectStatus, makeSession \}\)/,
          "Bank proof must execute in the guarded real HTTP/PG harness");
        assert.match(readFileSync(proof.file, "utf8"), /assert\.deepEqual\(after, before/,
          "Victim bank records and audit must remain unchanged");
      }
      if (proof.file === "scripts/qa/tenant-high-risk-01-http.mjs") {
        // Only an exact method-named, actually executed Batch 01 case may use
        // request(item.own) rather than an inline literal route in the proof.
        const evidence = readFileSync(proof.file, "utf8");
        const evidenceLines = evidence.split("\n");
        const spec = method.name + " " + entry.route;
        const signature = evidenceLine(proof.file, proof.line, spec + " exact method case");
        const harness = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
        assert.equal(method.name, "GET", spec + ": this does not authorize mutating methods");
        assert.ok(signature.includes('key: "' + spec + '"') ||
          signature.includes('await caseCheck("' + spec + '"'),
          spec + ": must link a distinct exact-route high-risk test case");
        assert.ok(harness.includes("verifyHighRiskBatchOne(f, { request, expectStatus, makeSession });") &&
          evidence.includes("for (const idx of [1, 2])") &&
          evidence.includes("assert.equal(passed.size, 36") &&
          evidence.includes("assert.deepEqual(victimAfter, victimBefore"),
          spec + ": both attacker sessions and unchanged victim PostgreSQL rows required");
        const positive = evidenceLine(proof.file, proof.ownPositiveLine, spec + " own 200");
        const denial = evidenceLine(proof.file, proof.foreignDenialLine, spec + " denied");
        const invariant = evidenceLine(proof.file, proof.unchangedDbLine, spec + " victim DB");
        assert.match(invariant, /assert\.deepEqual\(victimAfter, victimBefore/);
        if (spec === "GET self/documents") {
          assert.ok(positive.includes('request("/api/self/documents"') &&
            denial.includes("request(endpoint") && denial.includes("), 403,") &&
            evidence.includes("victim.id +") && evidence.includes("cookie: employeeCookie"),
            spec + ": forged selector and former-employer revocation require active employee session");
        } else if (spec === "GET self/payslips/[id]/explain") {
          assert.ok(positive.includes('request("/api/self/payslips/" + ownEntry.id') &&
            denial.includes('request("/api/self/payslips/" + victimEntry.id') &&
            evidence.includes("}), 404,") && evidence.includes("cookie: employeeCookie"),
            spec + ": actual own Released payslip 200 and victim pay entry 404 required");
        } else {
          const caseSpan = evidenceLines.slice(proof.line - 1, proof.line + 13).join("\n");
          assert.ok(caseSpan.includes('own: "/api/') &&
            caseSpan.includes('foreign: "/api/') &&
            (caseSpan.includes("victim.id") || caseSpan.includes("f.victimRun.id")),
            spec + ": missing method-specific own and victim actual route selectors");
          assert.ok(positive.includes("expectStatus(await request(item.own") &&
            denial.includes("expectStatus(await request(item.foreign") &&
            evidence.includes("), 403,"),
            spec + ": authenticated own 200 and victim 403 HTTP pair required");
        }
        continue;
      }
      const ownLine = evidenceLine(proof.file, proof.ownPositiveLine, path + " own-positive");
      const negativeLine = evidenceLine(proof.file, proof.foreignDenialLine, path + " foreign denial");
      assert.ok(routeFragments.every(fragment => ownLine.includes(fragment)) && /request\s*\(/.test(ownLine),
        path + " " + method.name + ": stale positive reference");
      assert.ok(/expectStatus|ownOnly|assert\.(?:ok|equal|deepEqual)/.test(negativeLine),
        path + " " + method.name + ": stale foreign-denial or DB proof");
      if (proof.unchangedDbLine) {
        const invariant = evidenceLine(proof.file, proof.unchangedDbLine, path + " invariant");
        assert.match(invariant, /assert\.(?:deepEqual|equal)/);
      }
    }
  }
  for (const [route, method, positiveVariable, success] of [
    ["account/sessions", "DELETE", "ownSessionDelete", 200],
    ["scim/v2/Users/[id]", "PATCH", "ownScimPatch", 200],
    ["scim/v2/Users/[id]", "DELETE", "ownScimDelete", 204],
    ["v1/employees/[id]", "PATCH", "ownV1Patch", 200],
    ["v1/employees/[id]", "DELETE", "ownV1Delete", 200],
  ]) {
    const key = "src/app/api/" + route + "/route.ts";
    const methodProof = manifest.allApiRouteFiles[key].methods.find((v) => v.name === method);
    assert.equal(methodProof?.status, "COVERED",
      key + " " + method + ": cross-tenant denial alone is insufficient");
    const proof = methodProof.testedBy;
    const positive = evidenceLine(proof.file, proof.ownPositiveLine, key + " own");
    const victim = evidenceLine(proof.file, proof.foreignDenialLine, key + " victim");
    const ownSpan = source.slice(proof.ownPositiveLine - 1, proof.ownPositiveLine + 6).join("\n");
    const victimSpan = source.slice(proof.foreignDenialLine - 1, proof.foreignDenialLine + 5).join("\n");
    assert.ok(positive.includes("const " + positiveVariable + " = expectStatus") &&
      positive.includes("/api/" + route.replaceAll("[id]", "")) &&
      ownSpan.includes("), " + success + ","),
      key + " " + method + ": missing same-method own success");
    assert.ok(victim.includes('expectStatus(await request("/api/' + route.replaceAll("[id]", "")) &&
      victimSpan.includes("), 404,") &&
      (victimSpan.includes("f.victimIdentity.id") ||
        victimSpan.includes("checkVictimId") ||
        victimSpan.includes("f.victimSessions.at(-1).id")),
      key + " " + method + ": real existing victim-only record must be denied");
    const unchanged = evidenceLine(proof.file, proof.unchangedDbLine, key + " unchanged");
    assert.match(unchanged, /assert\.(?:deepEqual|equal)\(victim/,
      key + " " + method + ": denied mutation must preserve victim data");
  }
});

test("page and server-action inventory cannot silently omit new or changed business-ID entrypoints", () => {
  const files = appFiles();
  const scoped = new Map(manifest.scopedPages.map((entry) => [entry.path, entry]));
  assert.equal(Object.keys(baseline.app).length, 92,
    "original app/module baseline scope is pinned to the audited 92-file snapshot");
  for (const [path, entry] of scoped) {
    assert.ok(files.includes(path), "scoped page entry must exist: " + path);
    assert.ok(entry.business && entry.business.length > 0 || entry.hasAction,
      "scoped page entry must cite business ID/source action evidence: " + path);
  }
  for (const path of files) {
    const content = readFileSync(path);
    const current = gitBlobSha(content);
    const original = baseline.app[path];
    const actual = content.toString("utf8");
    const scopedCandidate = /\b(?:organizationId|legalEntityId|employeeId|payrollRunId|runId|payslipId|documentId|fileId|caseId|positionId|orgUnitId|approvalId)\b/.test(actual)
      || /["']use server["']/.test(actual);
    const changed = !original || original !== current;
    if (scopedCandidate && scoped.has(path)) {
      const entry = scoped.get(path);
      if (!changed) assert.equal(entry.blob, current, path + ": pinned page SHA mismatch");
    }
    if (scopedCandidate && changed) {
      const entry = scoped.get(path);
      assert.ok(entry, path + ": new or changed scoped page/server action not in manifest");
      assert.ok(["COVERED", "PUBLIC-BY-DESIGN"].includes(entry.status),
        path + ": changed scoped entry still lacks valid same-employer + foreign-employer proof");
      if (entry.status === "COVERED") {
        const proof = entry.testedBy;
        assert.ok(proof, path + ": page COVERED needs actual browser/HTTP proof");
        const own = evidenceLine(proof.file, proof.ownPositiveLine, path + " own session");
        const foreign = evidenceLine(proof.file, proof.foreignDenialLine, path + " foreign session");
        if (path === "src/app/hcm/manager-decision-inbox/page.tsx") {
          assert.equal(proof.file, "scripts/qa/hcm-manager-inbox-page-http.mjs");
          assert.match(own, /const ownPage = await requestOn\(/);
          assert.match(foreign, /const foreignPage = await requestOn\(/);
          const proofSource = readFileSync(proof.file, "utf8");
          const runner = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
          assert.match(proofSource, /HCM_MANAGER_DECISION_INBOX_ENABLED: "true"/);
          assert.match(proofSource, /HCM_MANAGER_DECISION_INBOX_ORG_IDS: f\.orgs\.map/);
          assert.match(proofSource, /for \(const idx of \[1, 2\]\)/);
          assert.match(proofSource, /assert\.equal\(ownPage\.status, 200/);
          assert.match(proofSource, /assert\.equal\(foreignPage\.status, 404/);
          assert.match(proofSource, /assert\.equal\(foreignApi\.status, 403/);
          assert.match(proofSource, /assert\.deepEqual\(await db\.select\(\)\.from\(payrollRuns\)/);
          assert.match(runner, /verifyHcmManagerInboxPage\(f\)/);
        }
      } else {
        assert.ok(typeof entry.reason === "string" && entry.reason.trim().length >= 20,
          path + ": public-by-design requires a reviewed reason");
      }
    }
  }
  assert.equal(manifest.metrics.scopedPagesAndActions, manifest.scopedPages.length);
});

test("original three-employer HTTP hard-refuse and anti-false-pass guards remain intact", () => {
  const smoke = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
  for (const required of [
    'process.env.CI !== "true"',
    'process.env.TENANT_SECOND_PASS_MODE !== "isolated-ci-only"',
    'app.hostname !== "127.0.0.1"',
    'database.pathname !== "/app_db"',
    'process.env.PAYMONGO_DISBURSEMENTS_ENABLED === "true"',
    'process.env.XENDIT_PAYOUTS_ENABLED === "true"',
    'Victim-only ID must really exist and exceed 6',
    'Cross-tenant employee PATCH/DELETE must have no victim side effects',
  ]) {
    assert.ok(smoke.includes(required), "hard refuse/negative-control marker lost: " + required);
  }
  const workflow = readFileSync(".github/workflows/security-http-smoke.yml", "utf8");
  assert.match(workflow, /npx tsx scripts\/qa\/tenant-second-pass-http\.mjs/,
    "existing real-HTTP three-employer fixture must remain in Security HTTP Smoke");
  assert.match(workflow, /node --test tests\/tenant-second-pass-inventory\.test\.mjs tests\/tenant-isolation-coverage-inventory\.test\.mjs/,
    "security smoke must invoke the original test alongside the full-surface drift guard");
});

test("real-HTTP login audit for the public credential exchange cannot target a forged employer", () => {
  const path = "src/app/api/auth/login/route.ts";
  const route = readFileSync(path, "utf8");
  const writer = readFileSync("src/lib/audit.ts", "utf8");
  const entry = manifest.allApiRouteFiles[path];
  const method = entry.methods.find(item => item.name === "POST");
  assert.equal(method?.status, "PUBLIC-BY-DESIGN");
  assert.match(method.reason, /server-derived active membership/);
  const proof = method.reviewedPublicProof;
  assert.equal(proof?.file, "scripts/qa/tenant-login-audit-http.mjs");
  assert.equal(proof?.harness, "scripts/qa/tenant-second-pass-http.mjs");
  const suite = readFileSync(proof.file, "utf8");
  const runner = readFileSync(proof.harness, "utf8");
  assert.match(runner, /verifyTenantLoginAuditIsolation\(\s*f,\s*\{\s*request,\s*expectStatus\s*\}\s*\)/);
  assert.ok(runner.includes('if (process.env.LOCAL_LOGIN_AUDIT_ENABLED === "true") await'),
    "Do not require audit receipts while the opt-in feature is disabled");
  const smokeWorkflow = readFileSync(".github/workflows/security-http-smoke.yml", "utf8");
  assert.match(smokeWorkflow, /LOCAL_LOGIN_AUDIT_ENABLED: "true"/,
    "The dedicated tenant security smoke must run live opt-in login-audit acceptance");
  assert.match(suite, /process\.env\.TENANT_SECOND_PASS_MODE, "isolated-ci-only"/);
  assert.match(suite, /for \(const idx of \[1, 2\]\)/);
  assert.match(suite, /hashPassword\(fictionalPassword\)/);
  assert.match(suite, /organizationId: victimOrg\.id, userId: f\.owners\[0\]\.id/);
  assert.match(evidenceLine(proof.file, proof.ownPositiveLine, "local login own HTTP"),
    /const own = expectStatus\(await request\(loginPath,/);
  assert.match(evidenceLine(proof.file, proof.invalidCredentialsLine, "local login 401"),
    /const invalid = expectStatus\(await request\(loginPath,/);
  assert.match(evidenceLine(proof.file, proof.foreignIsolationLine, "victim unchanged"),
    /assert\.deepEqual\(victimAfter, victimBefore,/);
  assert.match(evidenceLine(proof.file, proof.unchangedDbLine, "victim audit invariant"),
    /assert\.deepEqual\(victimAfter, victimBefore,/);
  assert.match(suite, /assert\.equal\(ownAfter\.length, ownBefore\.length \+ 1,/);
  assert.match(suite, /assert\.equal\(receipt\.organizationId, ownOrg\.id\)/);
  assert.match(suite, /assert\.deepEqual\(await tenantAuditRows\(victimOrg\.id\), victimBefore,/);
  assert.match(writer, /eq\(userOrganizations\.active, true\)/);
  assert.match(writer, /await tx\.insert\(auditEvents\)\.values\(memberships\.map\(/);
  const audit = route.indexOf("await recordSuccessfulLocalLogin({");
  const cookie = route.indexOf("jar.set(SESSION_COOKIE, session.token");
  assert.ok(audit > 0 && cookie > audit,
    "Sign-in audit must commit before browser session delivery");
  assert.match(route, /await revokeSession\(session\.token\)\.catch\(\(\) => \{\}\)/);
});
