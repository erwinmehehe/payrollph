#!/usr/bin/env node
/**
 * MKT-01 exact-source operator-only GET credit: regenerate inventory metrics
 * and source-linked documentation from actual method statuses.
 *
 * node scripts/qa/tenant-mkt01-marketing-credit.mjs --write
 * node scripts/qa/tenant-mkt01-marketing-credit.mjs --check
 *
 * The proof runner itself awards ZERO credits. This verifier requires an
 * already-reviewed sole-owner method receipt. It never changes classification.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const ROOT = "src/app/api/marketing/leads/route.ts";
const REPORT = "src/lib/marketing-report.ts";
const RUNNER = "scripts/qa/tenant-mkt01-marketing-report-http.mjs";
const CONTRACT = "scripts/qa/tenant-mkt01-marketing-report-contract.mjs";
const WORKFLOW = ".github/workflows/tenant-mkt01-marketing-report-http.yml";
const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
const OVERVIEW = "docs/engineering/tenant-isolation-coverage-inventory.md";
const CLOSURE = "docs/engineering/tenant-isolation-closure-plan.md";
const RUN_URL = "https://github.com/erwinmehehe/payrollph/actions/runs/43530460939/job/132246563132";
const HEAD = "bfedf16fecf0ff4e918da68972ac7a18488c4a4b";
const PINS = Object.freeze({
  [ROOT]: "69a046c25fb59ccc75c47b41d44c26b585e898b3",
  [REPORT]: "7371a252be449829b09e7a0ff501d77eb6d811fd",
  [RUNNER]: "3f6cbfa482865f2d0eba3156970d216c0e457c6c",
  [CONTRACT]: "efcd3832f64fc88efa3bf1092dfcb25943ae0740",
  [WORKFLOW]: "ea958afc04a2a965114d8c8a91a017981286687d",
});
const HEADLINE = "> **CURRENT MKT-01 OPERATOR-ONLY GET - SOLO_VERIFIED_DEV_RECOVERY / NOT ACCEPTED:** ";
const NOTE = " MKT-01 operator-only aggregate GET has one provisional SOLO_VERIFIED_DEV_RECOVERY source-pinned fictional PG16 localhost HTTP credit from " + RUN_URL +
  "; not PUBLIC-BY-DESIGN and not an employer-scoped API. Actual allowlist deployment configuration, arbitrary untrusted free-text campaign/landing metadata de-identification, independent privacy/security review and production acceptance are NOT tested or accepted.";
const TICK = String.fromCharCode(96);
function gitBlob(data) {
  const b = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return createHash("sha1").update("blob " + b.length + "\0").update(b).digest("hex");
}
export function assertMkt01Pins() {
  for (const [p, hash] of Object.entries(PINS))
    assert.equal(gitBlob(readFileSync(p)), hash, p + " differs from passing PG16 proof - RERUN");
  const lines = readFileSync(RUNNER, "utf8").split("\n");
  for (const [at, marker] of [
    [160, "const authorized = await auditedGet("],
    [153, "const outsider = await auditedGet("],
    [151, "const anonymous = await auditedGet("],
    [155, "const stale = await auditedGet("],
    [200, "for (const probe of ["],
    [145, "assertMkt01Unchanged(justBefore, await state()"],
    [254, 'await disabledAllowlistServer("empty", 3001)'],
    [255, 'await disabledAllowlistServer("unset", 3002)'],
    [262, "const revoked = await auditedGet("],
  ]) assert.ok(lines[at - 1]?.includes(marker), "executed four-part line shifted: " + at);
  const wf = readFileSync(WORKFLOW, "utf8");
  assert.match(wf, /image: postgres:16/);
  assert.ok(wf.includes("github.event.pull_request.head.sha || github.sha"));
  const src = readFileSync(ROOT, "utf8");
  for (const guard of ["getSessionUser()", "allowedEmails()", "requireSensitiveActionMfa(user)",
    "Aggregated report only."]) assert.ok(src.includes(guard), guard + " missing from unchanged operator route");
}
export function assertMkt01Receipt(manifest) {
  assertMkt01Pins();
  const route = manifest.allApiRouteFiles[ROOT], method = route?.methods?.[0], p = method?.testedBy;
  assert.equal(route?.gitBlobSha, PINS[ROOT]);
  assert.deepEqual(route?.methods?.map(m => m.name), ["GET"]);
  assert.equal(method?.status, "COVERED");
  assert.equal(method.reviewedUncertified, undefined, "superseded zero-credit hold must be removed");
  assert.match(method.reason, /operator-scoped.*SOLO_VERIFIED_DEV_RECOVERY/);
  const checks = {
    file: RUNNER, proofFile: RUNNER, line: 160, ownPositiveLine: 160,
    foreignDenialLine: 153, anonymousDenialLine: 151, staleMfaDenialLine: 155,
    forgedSelectorLine: 200, unchangedDbLine: 145, emptyAllowlistLine: 254,
    unsetAllowlistLine: 255, revokedSessionLine: 262,
    routeBlobSha: PINS[ROOT], reportFile: REPORT, reportBlobSha: PINS[REPORT],
    proofBlobSha: PINS[RUNNER], contractFile: CONTRACT, contractBlobSha: PINS[CONTRACT],
    workflowFile: WORKFLOW, workflowBlobSha: PINS[WORKFLOW],
    workflowRunId: 43530460939, workflowJobId: 132246563132,
    evidence: RUN_URL, proofHeadSha: HEAD, proofEvent: "push", postgresMajor: 16,
    evidenceLabel: "SOLO_VERIFIED_DEV_RECOVERY", operatorScoped: true,
    publicByDesign: false, ownerIsOnlyReviewer: true, independentlyAccepted: false,
    independentSecurityReview: "PENDING", independentPrivacyReview: "PENDING",
    productionCertified: false, productionTested: false, productionMoneyMoved: false,
    realProspectDataUsed: false, allowlistDeploymentConfigurationTested: false,
    forgedQueryHeaderCookieSelectors: true, eachRequestDbSnapshot: true
  };
  for (const [key, expected] of Object.entries(checks))
    assert.deepEqual(p?.[key], expected, "MKT-01 credit proof pin/permission drift: " + key);
  return 1;
}
export function regeneratedManifest(original) {
  assertMkt01Receipt(original);
  const m = JSON.parse(JSON.stringify(original));
  const methods = Object.values(m.allApiRouteFiles).flatMap(route => route.methods);
  const tally = status => methods.filter(x => x.status === status).length;
  const computed = {
    routeFiles: Object.keys(m.allApiRouteFiles).length, methods: methods.length,
    coveredAfter: tally("COVERED"), publicByDesign: tally("PUBLIC-BY-DESIGN"),
    privilegedOperationsTokenOnly: tally("PRIVILEGED-OPERATIONS-TOKEN-ONLY"),
    gap: tally("GAP")
  };
  for (const [k, v] of Object.entries(computed)) m.metrics[k] = v;
  assert.equal(computed.coveredAfter + computed.publicByDesign +
    computed.privilegedOperationsTokenOnly + computed.gap, computed.methods);
  m.acceptanceStatus = m.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/,
    "NOT ACCEPTED: " + computed.gap + " API methods");
  assert.ok(m.acceptanceStatus.startsWith("NOT ACCEPTED: "));
  if (!m.acceptanceStatus.includes(NOTE)) m.acceptanceStatus += NOTE;
  return m;
}
function heading(manifest) {
  const x = manifest.metrics;
  const gaps = manifest.scopedPages.filter(p => p.status === "GAP").length;
  return HEADLINE + x.methods + " methods = " + x.coveredAfter + " COVERED + " +
    x.publicByDesign + " PUBLIC-BY-DESIGN + " +
    x.privilegedOperationsTokenOnly + " PRIVILEGED-OPERATIONS-TOKEN-ONLY + " +
    x.gap + " GAP; " + gaps + " scoped page/action GAPs remain. " +
    "Single operator-scoped provisional credit, NOT PUBLIC-BY-DESIGN. " +
    "[Exact-source fictional PG16 HTTP proof](" + RUN_URL + "). " +
    "No independent privacy/security approval, deployment allowlist attestation, production release, providers or money.";
}
function withCurrentHeading(doc, m) {
  if (doc.startsWith(HEADLINE)) {
    const at = doc.indexOf("\n\n");
    assert.ok(at > 0, "MKT-01 heading drift");
    doc = doc.slice(at + 2);
  }
  return heading(m) + "\n\n" + doc;
}
export function regeneratedOverview(doc, m) {
  const lines = withCurrentHeading(doc, m).split("\n");
  let seen = 0;
  const next = lines.map(line => {
    if (!line.includes("[" + TICK + "marketing/leads" + TICK + " GET]")) return line;
    seen++;
    assert.ok(line.includes("src/app/api/marketing/leads/route.ts#L16"));
    const suffix = "[MKT-01 operator-only PG16 proof](../../scripts/qa/tenant-mkt01-marketing-report-http.mjs#L160) | **COVERED** |";
    const result = line.replace(/(?:NO VALID METHOD PROOF|\[MKT-01 operator-only PG16 proof\]\([^)]+\))\s*\| \*\*(?:GAP|COVERED)\*\* \|$/, suffix);
    assert.ok(result.endsWith(suffix), "operator summary row was not reconciled");
    return result;
  });
  assert.equal(seen, 1, "operator endpoint must have exactly one source-linked overview row");
  return next.join("\n");
}
export function regeneratedClosure(doc, m) {
  doc = withCurrentHeading(doc, m);
  const start = doc.indexOf("### Current 406-method frozen batch queue");
  const end = doc.indexOf("### Three narrowly promoted API methods", start);
  assert.ok(start >= 0 && end > start, "frozen queue source block missing");
  let block = doc.slice(start, end);
  const source = doc.split("### Batch DL-01 —")[1]?.split("## Page and server-action closure")[0];
  assert.ok(source, "frozen method source links unavailable");
  const sections = ("### Batch DL-01 —" + source).split("### Batch ").slice(1);
  assert.equal(sections.length, 12);
  const fresh = { COVERED: 0, "PUBLIC-BY-DESIGN": 0,
    "PRIVILEGED-OPERATIONS-TOKEN-ONLY": 0, GAP: 0 };
  let frozenMethods = 0, incomplete = 0;
  const lines = block.split("\n");
  for (const section of sections) {
    const [header, ...content] = section.split("\n");
    const id = header.split(" ")[0];
    const links = content.filter(line => line.startsWith("- " + TICK) &&
      line.includes(" — [source](../../src/app/api/"));
    const count = { COVERED: 0, "PUBLIC-BY-DESIGN": 0,
      "PRIVILEGED-OPERATIONS-TOKEN-ONLY": 0, GAP: 0 };
    for (const line of links) {
      const methodName = line.split(TICK)[1].split(" ")[0];
      const path = line.split(" — [source](../../")[1]?.split("#L")[0];
      const method = m.allApiRouteFiles[path]?.methods.find(x => x.name === methodName);
      assert.ok(method && Object.hasOwn(count, method.status), "frozen route identity invalid: " + path);
      count[method.status]++; fresh[method.status]++; frozenMethods++;
    }
    if (count.GAP) incomplete++;
    const at = lines.findIndex(x => x.startsWith("| ") && x.includes("**" + id + "**"));
    assert.ok(at >= 0, "missing frozen batch summary: " + id);
    const old = lines[at].split("|").map(v => v.trim());
    lines[at] = "| " + old[1] + " | **" + id + "** | " + links.length + " | " +
      count.COVERED + " | " + count["PUBLIC-BY-DESIGN"] + " | " +
      count["PRIVILEGED-OPERATIONS-TOKEN-ONLY"] + " | " + count.GAP + " | " +
      (count.GAP ? "INCOMPLETE" : "PROVISIONAL — NOT ACCEPTED") + " |";
  }
  assert.equal(frozenMethods, 406, "frozen batch membership/size changed");
  const i = lines.findIndex(s => s.startsWith("Frozen subtotal ("));
  assert.ok(i >= 0, "frozen subtotal missing");
  const x = m.metrics;
  lines[i] = "Frozen subtotal (2026-11-14 MKT-01 source-linked regeneration): **" +
    fresh.COVERED + " COVERED + " + fresh["PUBLIC-BY-DESIGN"] + " PUBLIC-BY-DESIGN + " +
    fresh["PRIVILEGED-OPERATIONS-TOKEN-ONLY"] + " PRIVILEGED-OPERATIONS-TOKEN-ONLY + " +
    fresh.GAP + " GAP = 406**. Relative to the live " + x.methods +
    "-method ledger, the other **" + (x.methods - 406) + " methods** are **" +
    (x.coveredAfter - fresh.COVERED) + " COVERED + " +
    (x.publicByDesign - fresh["PUBLIC-BY-DESIGN"]) + " PUBLIC-BY-DESIGN + " +
    (x.privilegedOperationsTokenOnly - fresh["PRIVILEGED-OPERATIONS-TOKEN-ONLY"]) +
    " TOKEN-ONLY + " + (x.gap - fresh.GAP) + " GAP**. " +
    incomplete + " batches remain INCOMPLETE. All other batches remain PROVISIONAL — NOT ACCEPTED.";
  block = lines.join("\n");
  return doc.slice(0, start) + block + doc.slice(end);
}
export function artifacts() {
  const m = regeneratedManifest(JSON.parse(readFileSync(MANIFEST, "utf8")));
  return {
    [MANIFEST]: JSON.stringify(m, null, 2) + "\n",
    [OVERVIEW]: regeneratedOverview(readFileSync(OVERVIEW, "utf8"), m),
    [CLOSURE]: regeneratedClosure(readFileSync(CLOSURE, "utf8"), m)
  };
}
export function verifyMkt01Credit(candidate) {
  if (candidate) {
    const current = JSON.parse(readFileSync(MANIFEST, "utf8"));
    const target = candidate.allApiRouteFiles?.[ROOT]?.methods?.find(m => m.name === "GET");
    const audited = current.allApiRouteFiles?.[ROOT]?.methods?.find(m => m.name === "GET");
    assert.deepEqual(target, audited,
      "Only the source-pinned, exact operator GET receipt may coexist with other family credits");
  }
  for (const [path, generated] of Object.entries(artifacts()))
    assert.equal(readFileSync(path, "utf8"), generated,
      path + " metrics/summary not generated from actual method statuses - run --write");
  return 1;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const mode = process.argv[2] ?? "--check";
  assert.ok(["--write", "--check"].includes(mode));
  const output = artifacts();
  if (mode === "--write") {
    for (const [path, value] of Object.entries(output)) writeFileSync(path, value);
  } else verifyMkt01Credit();
  const m = JSON.parse(output[MANIFEST]).metrics;
  console.log(JSON.stringify({ label: "SOLO_VERIFIED_DEV_RECOVERY", mode,
    source: PINS[ROOT], methods: m.methods, covered: m.coveredAfter,
    public: m.publicByDesign, tokenOnly: m.privilegedOperationsTokenOnly,
    gaps: m.gap, acceptance: "NOT ACCEPTED" }));
}
