import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";

const contribution = readFileSync("src/app/api/self/contribution-issues/route.ts", "utf8");
const identifiers = readFileSync("src/app/api/self/identifiers/route.ts", "utf8");
const harness = readFileSync("scripts/qa/tenant-ess-statutory-identity-http.mjs", "utf8");
const runner = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");

test("ESS case GET and POST check CURRENT employee employer membership before accessing case data", () => {
  const context = contribution.split("async function employeeContext() {")[1]?.split("\nexport async function GET()")[0];
  assert.ok(context, "shared employeeContext must exist");
  assert.match(contribution, /import \{ assertMembership \} from "@\/lib\/access"/);
  assert.ok(context.includes("eq(employees.id, user.employeeId)"),
    "linked employee identity must be resolved by authenticated session ID");
  const lookup = context.indexOf("const [employee] = await db.select()");
  const guard = context.indexOf("await assertMembership(user.id, employee.organizationId)");
  const denied = context.indexOf("if (membershipDenied) return { user, employee: null, denied: membershipDenied };");
  const returnValid = context.indexOf("return { user, employee, denied: null };");
  assert.ok(lookup >= 0 && lookup < guard && guard < denied && denied < returnValid,
    "active employer membership must be checked on the DB employee's employer before allowing any case read or write");
  const get = contribution.split("\nexport async function GET()")[1]?.split("\nexport async function POST(")[0];
  const post = contribution.split("\nexport async function POST(")[1];
  assert.ok(get?.includes("const context = await employeeContext();"));
  assert.ok(post?.includes("const context = await employeeContext();"));
  assert.ok(get.includes("if (context.denied) return context.denied;"));
  assert.ok(post.includes("if (context.denied) return context.denied;"));
  assert.ok(get.indexOf("if (context.denied)") < get.indexOf("statutoryContributionIssueCases"),
    "rejected GET must never inspect a former employer's case rows");
  assert.ok(post.indexOf("if (context.denied)") < post.indexOf("enforceSensitiveActionRateLimit"),
    "rejected POST must not rate-limit or queue an employer's case as a side effect");
});

test("ESS identifiers retain employee-bound lookup, employer membership and encryption", () => {
  const context = identifiers.split("async function context() {")[1]?.split("\nexport async function GET()")[0];
  assert.ok(context?.includes("await assertMembership(session.id, employee.organizationId)"),
    "stale user/employee link must not authorize the former employer");
  assert.match(identifiers, /eq\(essIdentifierRequests\.organizationId, ctx\.employee\.organizationId\)/);
  assert.match(identifiers, /eq\(essIdentifierRequests\.employeeId, ctx\.employee\.id\)/);
  assert.match(identifiers, /proposedEncrypted = encryptGovernmentId\(parsed\.value, \{ required: true \}\)/);
  assert.match(identifiers, /organizationId: ctx\.employee\.organizationId,\s*\n\s*employeeId: ctx\.employee\.id/);
  assert.doesNotMatch(identifiers, /organizationId:\s*(?:body|query)\.organizationId/);
});

test("four ESS methods execute in real guarded HTTP/PG16 with populated own and victim controls", () => {
  for (const verb of ["GET", "POST"]) {
    for (const file of [identifiers, contribution]) {
      assert.match(file, new RegExp("export async function " + verb + "\\("));
    }
  }
  assert.match(harness, /ESS_METHODS = Object\.freeze\(\[/);
  assert.match(harness, /GET self\/identifiers/);
  assert.match(harness, /POST self\/identifiers/);
  assert.match(harness, /GET self\/contribution-issues/);
  assert.match(harness, /POST self\/contribution-issues/);
  assert.match(runner, /verifyEssStatutoryIdentityIsolation\(f, \{ request, expectStatus, makeSession \}\)/);
  assert.match(harness, /for \(const index of \[1, 2\]\)/);
  assert.match(harness, /f\.victimEmployee\.id > 6/);
  assert.match(harness, /await readOwn\(http, attacker/);
  assert.match(harness, /statutoryRemittanceBatches/);
  assert.match(harness, /statutoryRemittanceMembers/);
  assert.match(harness, /victimMember\.organizationId === victim\.org\.id/);
  assert.match(harness, /victimCase\.remittanceMemberId, victimMember\.id/);
  assert.match(harness, /memberId: victimMember\.id/);
  assert.match(harness, /404, "real other-employer remittance member ID must be denied"/);
  assert.match(harness, /assert\.deepEqual\(await snapshot\(victim\.org\.id\), victimBefore/);
  assert.match(harness, /id === row\.id && r\.kind === row\.kind && r\.proposedMasked/);
  assert.match(harness, /r\.id === row\.id && r\.description === row\.description/);
});

test("forged selectors and a still-authenticated revoked employer receive negative HTTP proof", () => {
  assert.match(harness, /organizationId: victim\.org\.id, employeeId: victim\.employeeId/);
  assert.match(harness, /await db\.update\(userOrganizations\)\.set\(\{ active: false \}\)/);
  assert.match(harness, /eq\(userOrganizations\.active, true\)/);
  assert.match(harness, /request\("\/api\/auth\/me", \{ cookie: victim\.cookie \}\)/);
  for (const endpoint of ["identifiers", "contribution-issues"]) {
    assert.ok(harness.includes('"/api/self/' + endpoint + '"'), "must exercise " + endpoint);
  }
  assert.match(harness, /403, "revoked employer membership blocks old-employer GET/);
  assert.match(harness, /403, "revoked employer membership blocks identity POST"/);
  assert.match(harness, /403, "revoked employer membership blocks contribution case POST"/);
  assert.match(harness, /cases, events, identities, audits, tasks and outbox unchanged/);
});

test("synthetic proof refuses remote services, production databases and provider money", () => {
  assert.match(harness, /process\.env\.CI, "true"/);
  assert.match(harness, /process\.env\.TENANT_SECOND_PASS_MODE, "isolated-ci-only"/);
  assert.match(harness, /http:\/\/127\.0\.0\.1:3000\//);
  assert.match(harness, /pg\.hostname, "127\.0\.0\.1"/);
  assert.match(harness, /pg\.pathname, "\/app_db"/);
  assert.match(harness, /process\.env\.PII_ENCRYPTION_KEY/);
  assert.match(harness, /process\.env\.RESEND_API_KEY &&/);
  assert.match(harness, /!process\.env\.POSTMARK_SERVER_TOKEN && !process\.env\.SMTP_URL/);
  assert.match(harness, /process\.env\.PAYMONGO_SECRET_KEY && !process\.env\.XENDIT_SECRET_KEY/);
  assert.doesNotMatch(harness, /fetch\(["']https:|submitXendit|submitPaymongo|releasePayroll/);
});


test("changed contribution route is source-pinned with two provisional proofs and no inflated ESS credits", () => {
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const contributionPath = "src/app/api/self/contribution-issues/route.ts";
  const entry = manifest.allApiRouteFiles[contributionPath];
  const sha = createHash("sha1")
    .update(Buffer.from("blob " + Buffer.byteLength(contribution) + "\0"))
    .update(Buffer.from(contribution)).digest("hex");
  assert.equal(entry.gitBlobSha, sha, "route inventory must match the exact current source");
  const proofLines = harness.split("\n");
  assert.deepEqual(entry.methods.map(method => method.name), ["GET", "POST"]);
  for (const method of entry.methods) {
    assert.equal(method.status, "COVERED", method.name + " requires documented provisional evidence");
    assert.match(method.reason, /PROVISIONAL/);
    const proof = method.testedBy;
    assert.equal(proof?.file, "scripts/qa/tenant-ess-statutory-identity-http.mjs");
    assert.equal(proof.denialKind, "same-session-revoked-membership");
    assert.equal(proof.foreignStatus, 403);
    assert.equal(proof.ownStatus, method.name === "GET" ? 200 : 201);
    for (const field of ["line", "ownPositiveLine", "foreignDenialLine", "unchangedDbLine", "victimIdOrderingLine"]) {
      assert.ok(Number.isInteger(proof[field]) && proof[field] >= 1 &&
        proof[field] <= proofLines.length, method.name + ": invalid " + field + " evidence pin");
    }
    assert.equal(proof.line, proof.ownPositiveLine);
    const own = proofLines[proof.ownPositiveLine - 1];
    const denied = proofLines[proof.foreignDenialLine - 1];
    const ownSpan = proofLines.slice(proof.ownPositiveLine - 1, proof.ownPositiveLine + 7).join("\n");
    const deniedSpan = proofLines.slice(proof.foreignDenialLine - 1, proof.foreignDenialLine + 7).join("\n");
    if (method.name === "GET") {
      assert.match(own, /const caseResponse = expectStatus\(await request\(/);
      assert.match(ownSpan, /\/api\/self\/contribution-issues/);
      assert.match(ownSpan, /\), 200,/);
      assert.match(denied, /const revokedContributionGet = expectStatus\(await request\("\/api\/self\/contribution-issues"/);
      assert.match(deniedSpan, /\), 403,/);
    } else {
      assert.match(own, /const result = expectStatus\(await request\("\/api\/self\/contribution-issues"/);
      assert.match(ownSpan, /method: "POST"/);
      assert.match(ownSpan, /\), 201,/);
      assert.match(denied, /const caseDenied = expectStatus\(await request\("\/api\/self\/contribution-issues"/);
      assert.match(deniedSpan, /method: "POST"/);
      assert.match(deniedSpan, /\), 403,/);
      assert.match(proofLines[proof.forgedForeignMemberDenialLine - 1], /const forbiddenMember = expectStatus/);
      assert.match(proofLines[proof.victimMemberHighIdLine - 1], /victimMember\?\.id > 6/);
    }
    assert.match(proofLines[proof.unchangedDbLine - 1], /assert\.deepEqual\(await snapshot\(victim\.org\.id\), victimBefore/);
    assert.match(proofLines[proof.victimIdOrderingLine - 1], /f\.victimEmployee\.id > 6/);
  }
  assert.deepEqual(manifest.allApiRouteFiles["src/app/api/self/identifiers/route.ts"].methods
    .map(m => [m.name, m.status]), [["GET", "GAP"], ["POST", "GAP"]],
    "unchanged ESS identifiers must not receive accidental credits");
  assert.equal(manifest.metrics.coveredAfter, 259);
  assert.equal(manifest.metrics.gap, 226);
  assert.match(manifest.acceptanceStatus, /^NOT ACCEPTED: 226 API methods/);
});
