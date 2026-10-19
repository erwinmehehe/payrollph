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
const BASE = "d94c1f3e0e1a8b1de0d15186923f3ed641314214";
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
