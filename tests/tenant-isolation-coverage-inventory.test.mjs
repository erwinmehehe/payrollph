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
function reviewedStatus(method, key, isNewOrChanged) {
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
      reviewedStatus(method, path + " " + method.name, changed);
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
      assert.ok(["scripts/qa/tenant-second-pass-http.mjs", "scripts/qa/payroll-approved-exit-http.mjs",
        "scripts/qa/payroll-read-sweep-http.mjs", "scripts/qa/bank-tenant-http.mjs",
        "scripts/qa/workforce-attendance-sweep-http.mjs"].includes(proof?.file),
        path + " " + method.name + ": unsupported evidence source");
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
      if (proof.file === "scripts/qa/bank-tenant-http.mjs") {
        assert.match(readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8"),
          /await \(await import\("\.\/bank-tenant-http\.mjs"\)\)\.verifyBankTenantIsolation\(f, \{ request, expectStatus, makeSession \}\)/,
          "Bank proof must execute in the guarded real HTTP/PG harness");
        assert.match(readFileSync(proof.file, "utf8"), /assert\.deepEqual\(after, before/,
          "Victim bank records and audit must remain unchanged");
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
        evidenceLine(proof.file, proof.ownPositiveLine, path + " own session");
        evidenceLine(proof.file, proof.foreignDenialLine, path + " foreign session");
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
