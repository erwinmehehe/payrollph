import assert from "node:assert/strict";
import { verifyCredit as verifyClockCredit } from "./tenant-clock-credit.mjs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// Fail-closed source and receipt links for three exact completed final-head
// PG16/localhost HTTP proofs. This never replaces empirical testing, nor
// grants global isolation or independent security acceptance.
const BASE = "fe3ad8901bfa714d59639d9f59a13cf133eeab36";
const CASES = [
  {
    "key": "GET self/schedule-receipts",
    "pr": 1520,
    "run": 40631756084,
    "head": "04ee4d99143c290b6f3bf0a1642935f42f7a2764",
    "routeBlob": "b490bbb2aab7471901b769bd410c80652566daf8",
    "proofBlob": "090f7a0a605eab6c87d4ab858b9e424c1008f7dd",
    "file": "scripts/qa/tenant-self-schedule-receipts-http.mjs",
    "workflow": ".github/workflows/tenant-self-schedule-receipts-http.yml",
    "own": 123,
    "foreign": 222,
    "unchanged": 253,
    "forged": 131,
    "denialKind": "real higher-ID victim employee misbound to attacker-employer session (403) plus revoked-former-employer membership 403"
  },
  {
    "key": "POST self/schedule-receipts",
    "pr": 1520,
    "run": 40631756084,
    "head": "04ee4d99143c290b6f3bf0a1642935f42f7a2764",
    "routeBlob": "b490bbb2aab7471901b769bd410c80652566daf8",
    "proofBlob": "090f7a0a605eab6c87d4ab858b9e424c1008f7dd",
    "file": "scripts/qa/tenant-self-schedule-receipts-http.mjs",
    "workflow": ".github/workflows/tenant-self-schedule-receipts-http.yml",
    "own": 144,
    "foreign": 224,
    "unchanged": 253,
    "forged": 197,
    "denialKind": "real higher-ID victim employee misbound 403; stolen real victim receipt hash 409; revoked former-employer same session 403"
  },
  {
    "key": "GET workforce/demand-observations/issued",
    "pr": 1514,
    "run": 40624976387,
    "head": "b5c422e6bd010b5b5fb890e6250a20cbbaff3d7f",
    "routeBlob": "d9e6ae99e687b691ca428e58c6c34ff077769a41",
    "proofBlob": "edd6146bfdb1d57d763bd869c863b9d62ebbdfb3",
    "file": "scripts/qa/tenant-demand-governance-recovery-http.mjs",
    "workflow": ".github/workflows/tenant-demand-governance-recovery-http.yml",
    "own": 159,
    "foreign": 177,
    "unchanged": 272,
    "forged": 195,
    "denialKind": "genuine higher-ID victim employer denied 403; stolen real victim worksite under own employer denied 403"
  }
];

function gitBlob(text) {
  const bytes = Buffer.from(text, "utf8");
  return createHash("sha1").update("blob " + bytes.length + "\0")
    .update(bytes).digest("hex");
}

export function verifyMoreCredits(manifest, read = path => readFileSync(path, "utf8")) {
  const credited = Object.values(manifest.allApiRouteFiles)
    .flatMap(route => route.methods.map(m => ({ key: m.name + " " + route.route, m })))
    .filter(x => x.m.testedBy?.verifiedMainCommit === BASE)
    .map(x => x.key).sort();
  assert.deepEqual(credited, CASES.map(c => c.key).sort(),
    "only three exact reviewed methods may reuse this sweep's evidence base");
  const seen = new Map();
  const checkFile = (path, expected) => {
    if (!seen.has(path)) seen.set(path, read(path));
    const contents = seen.get(path);
    assert.equal(gitBlob(contents), expected, "reviewed source blob drift: " + path);
    return contents;
  };
  for (const c of CASES) {
    const i = c.key.indexOf(" "), name = c.key.slice(0, i), route = c.key.slice(i + 1);
    const routeFile = "src/app/api/" + route + "/route.ts";
    const entry = manifest.allApiRouteFiles[routeFile];
    assert.ok(entry && entry.route === route, c.key + ": wrong route");
    assert.equal(entry.gitBlobSha, c.routeBlob, c.key + ": wrong route SHA");
    checkFile(routeFile, c.routeBlob);
    const matching = entry.methods.filter(m => m.name === name);
    assert.equal(matching.length, 1, c.key + ": missing or duplicated method");
    const method = matching[0], receipt = method.testedBy;
    assert.equal(method.status, "COVERED", c.key + ": expected method credit");
    assert.ok(receipt && method.reason?.includes("PROVISIONAL"),
      c.key + ": no independently verified provisional receipt");
    const pins = {
      file: c.file, line: c.own, ownPositiveLine: c.own,
      foreignDenialLine: c.foreign, unchangedDbLine: c.unchanged,
      forgedSelectorLine: c.forged, denialKind: c.denialKind,
      prNumber: c.pr, workflowRunId: c.run,
      proofHeadCommit: c.head, verifiedMainCommit: BASE, postgresMajor: 16,
      routeBlobSha: c.routeBlob, proofBlobSha: c.proofBlob,
    };
    for (const [field, value] of Object.entries(pins))
      assert.equal(receipt[field], value, c.key + ": unreviewed " + field);
    assert.ok(receipt.evidence?.startsWith(
      "https://github.com/erwinmehehe/payrollph/actions/runs/" + c.run + " ("),
      c.key + ": unrelated proof workflow");
    const suite = checkFile(c.file, c.proofBlob), lines = suite.split("\n");
    for (const [field, at] of Object.entries({
      own: c.own, foreign: c.foreign, unchanged: c.unchanged, forged: c.forged
    })) assert.ok(Number.isSafeInteger(at) && at > 0 && at <= lines.length &&
      lines[at - 1].trim().length > 0, c.key + ": invalid " + field + " source pin");
    const own = lines[c.own - 1], foreign = lines[c.foreign - 1],
      unchanged = lines[c.unchanged - 1], forged = lines[c.forged - 1];
    if (c.key === "GET self/schedule-receipts") {
      assert.match(own, /const ownView = await get\(actor\)/);
      assert.match(foreign, /forged victim employee link GET/);
      assert.match(lines[c.foreign], /await get\(actor, ENDPOINT, session\.cookie\), 403/);
      assert.match(forged, /forgedGet = await get\(actor, ENDPOINT/);
      assert.match(suite, /post-revocation Alpha blocked/);
    } else if (c.key === "POST self/schedule-receipts") {
      assert.match(own, /const posted = await post\(actor, body\)/);
      assert.match(foreign, /forged victim employee link POST/);
      assert.match(lines[c.foreign], /await post\(actor, valid, ENDPOINT, session\.cookie\), 403/);
      assert.match(forged, /forged body employer\/employee/);
      assert.match(suite, /stolen victim schedule hash/);
      assert.match(suite, /const repeated = await post\(actor, body\)/);
    } else if (c.key === "GET workforce/demand-observations/issued") {
      assert.match(own, /const own = await request\(url, \{ cookie: attacker.cookie \}\)/);
      assert.match(foreign, /await denied\(endpoint\(row, victim\.org\.id/);
      assert.match(lines.slice(c.foreign - 1, c.foreign + 3).join("\n"),
        /attacker\.cookie, 403/);
      assert.match(forged, /const forged = await request\(url \+ forgedParam/);
      assert.match(suite, /stolen-worksite/);
      assert.match(suite, /kind === "issued"/);
    } else assert.fail("unexpected receipt key " + c.key);
    assert.match(unchanged, /assertUnchanged|assert\.deepEqual|ensureUnchanged/);
    const workflow = read(c.workflow);
    assert.match(workflow, /image: postgres:16/);
    assert.ok(workflow.includes("node --import tsx " + c.file) &&
      workflow.includes("127.0.0.1") && workflow.includes("npm run build"),
      c.key + ": proof must run real HTTP on disposable PG16");
  }
  // Merged #1524's route no longer matches #1518's successful historical
  // self-profile HTTP proof. This sweep is deliberately NOT a profile credit.
  // Source, supplemental audit-veto runner and its regression pins are exact.
  const profileRoute = "src/app/api/self/profile/route.ts";
  const profile = manifest.allApiRouteFiles[profileRoute];
  const profileMethod = profile?.methods.find(method => method.name === "PATCH");
  assert.equal(profile?.gitBlobSha, "41d26b23678e8822aff4701a611c429e97f659c3",
    "new atomic handler may not borrow historical #1518 route evidence");
  checkFile(profileRoute, profile.gitBlobSha);
  assert.equal(profileMethod?.status, "GAP", "no self-profile method credit without independent acceptance");
  assert.equal(profileMethod?.testedBy, null, "old #1518 route proof must not certify merged #1524");
  const atomic = profileMethod.reviewedUncertified;
  assert.equal(atomic?.kind, "pii02-self-profile-atomic-source-review-only");
  assert.equal(atomic?.coverageCredits, 0);
  assert.equal(atomic?.independentReview, "PENDING");
  assert.equal(atomic?.routeBlobSha, profile.gitBlobSha);
  assert.equal(atomic?.originalRouteBlobSha, "85b5bbf1aff9e1777fc523d067586f9870dc87a6");
  assert.equal(atomic?.file, "scripts/qa/tenant-self-profile-atomic-http.mjs");
  assert.equal(atomic?.fileBlobSha, "2bae931424036014f92211a50c4211824a61d7b1");
  checkFile(atomic.file, atomic.fileBlobSha);
  assert.equal(atomic?.testFile, "tests/tenant-self-profile-contract.test.mjs");
  assert.equal(atomic?.testBlobSha, "bda6d239383e0736302c1970cbc0aa78433ef470");
  checkFile(atomic.testFile, atomic.testBlobSha);
  assert.match(read("scripts/qa/tenant-self-profile-atomic-http.mjs"),
    /profileAuditRollbackProven: true/);
  assert.match(read(".github/workflows/tenant-self-profile-http.yml"), /image: postgres:16/);
  assert.match(read(".github/workflows/tenant-self-profile-http.yml"),
    /node --import tsx scripts\/qa\/tenant-self-profile-atomic-http\.mjs/);
  for (const [path, verb] of [
    ["src/app/api/workforce/demand-staffing/policies/route.ts", "GET"],
    ["src/app/api/workforce/demand-observations/issued/route.ts", "POST"],
    ["src/app/api/web-bundy/consent/route.ts", "POST"],
  ]) {
    const method = manifest.allApiRouteFiles[path]?.methods.find(m => m.name === verb);
    if (path === "src/app/api/web-bundy/consent/route.ts" && method?.status === "COVERED") {
      verifyClockCredit("POST web-bundy/consent", method);
      continue; // Independently executed consent lifecycle; cannot borrow this historical promotion.
    }
    assert.equal(method?.status, "GAP", path + " " + verb + ": incomplete proof");
    assert.equal(method?.testedBy, null, path + " " + verb + ": borrowed method evidence");
  }
  return CASES.length;
}
