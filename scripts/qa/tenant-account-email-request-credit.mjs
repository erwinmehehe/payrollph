import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const EMAIL_REQUEST_RECEIPT = Object.freeze({
  route: "src/app/api/account/email/route.ts",
  run: 42480663360,
  job: 128731667810,
  passedHead: "6af8197aee7efc90724fc49067d734c5bfa78f5a",
  jobUrl: "https://github.com/erwinmehehe/payrollph/actions/runs/42480663360/job/128731667810",
  hashes: Object.freeze({
    "src/app/api/account/email/route.ts": "b9c759114b8082b3493ef3c4671134dabbf7e72e",
    "scripts/qa/tenant-account-email-request-http.mjs": "2fb082e2369960d5a0b39551ffec5b8b13498387",
    "scripts/qa/tenant-account-email-request-contract.mjs": "ba1dfef040197adb94e5b2deda14d3520360925f",
    "tests/tenant-account-email-request-contract.test.mjs": "4842269e62ddc6bd591e71c09e1247962bce57fb",
    ".github/workflows/tenant-account-email-request-http.yml": "9a2af396fa9ea70adca8ebf7035bd41a83b8829f",
  }),
});
function sha(path) {
  const bytes = readFileSync(path);
  return createHash("sha1").update(Buffer.from("blob " + bytes.length + "\0")).update(bytes).digest("hex");
}
function checkLine(lines, at, marker) {
  assert.ok(Number.isInteger(at) && at > 0 && at <= lines.length, marker + " evidence line");
  assert.ok(lines[at - 1].includes(marker), marker + " proof moved or was modified");
}
export function verifyAccountEmailRequestCredit(manifest) {
  const receipt = EMAIL_REQUEST_RECEIPT;
  const route = manifest.allApiRouteFiles[receipt.route];
  const method = route?.methods.find(row => row.name === "POST");
  assert.equal(route?.route, "account/email");
  assert.deepEqual(route?.methods.map(row => row.name), ["POST"]);
  assert.equal(method?.status, "COVERED");
  assert.equal(method.reviewedUncertified, undefined, "old zero-credit exception must be removed");
  assert.ok(method.reason.startsWith("Provisional distinct method credit:"));
  const p = method.testedBy;
  assert.ok(p && typeof p === "object");
  assert.equal(p.file, "scripts/qa/tenant-account-email-request-http.mjs");
  assert.equal(p.workflowRunId, receipt.run);
  assert.equal(p.workflowJobId, receipt.job);
  assert.equal(p.verifiedPrHeadSha, receipt.passedHead);
  assert.equal(p.evidence, receipt.jobUrl);
  assert.equal(p.postgresMajor, 16);
  assert.equal(p.independentSecurityReview, "PENDING");
  assert.equal(p.independentlyAccepted, false);
  assert.equal(p.productionTested, false);
  assert.ok(p.scope.toLowerCase().includes("two independent employer owners"));
  for (const [path, expected] of Object.entries(receipt.hashes)) {
    assert.equal(sha(path), expected, "changed source invalidates prior executed PG16 proof: " + path);
  }
  assert.equal(route.gitBlobSha, receipt.hashes[receipt.route]);
  assert.equal(p.routeBlobSha, receipt.hashes[receipt.route]);
  assert.equal(p.proofBlobSha, receipt.hashes[p.file]);
  assert.equal(p.contractBlobSha, receipt.hashes[p.contractFile]);
  assert.equal(p.testBlobSha, receipt.hashes[p.testFile]);
  assert.equal(p.workflowBlobSha, receipt.hashes[p.workflowFile]);
  const runner = readFileSync(p.file, "utf8");
  const lines = runner.split("\n");
  const citations = [
    ["line", "const response = await post(attacker.cookie, {"],
    ["ownPositiveLine", "const response = await post(attacker.cookie, {"],
    ["foreignDenialLine", "const stolen = await denied(attacker.cookie, {"],
    ["unchangedDbLine", "assertPersistedUnchanged(victimBefore, await accountSnapshot(victim)"],
    ["forgedSelectorLine", "userId: victim.owner.id, organizationId: victim.org.id,"],
    ["victimIdOrderingLine", "victim.owner.id > Math.max(a.owner.id, b.owner.id, 6)"],
    ["twoAttackerLoopLine", 'for (const [attacker, key] of [[a, "a"], [b, "b"]]) {'],
    ["ownConfirmationLine", "assertOwnEmailRequest(response, email, forbidden);"],
  ];
  for (const [field, marker] of citations) checkLine(lines, p[field], marker);
  for (const marker of [
    "requireDisposableEmailRequest();", "startFictionalSmtpSink()",
    "assertLocalSmtpMessage(sink.messages.at(-1), email)",
    "assertPersistedUnchanged(peerBefore", "assertPersistedUnchanged(victimBefore",
    "await successfulRequest(a,", "await successfulRequest(b,",
    "foreignAccountGrantsTokensSessionsAuditOutboxUnchanged: true",
    "noRealMailOrPayroll: true", "coverageCredits: 0",
  ]) assert.ok(runner.includes(marker), "proof marker missing: " + marker);
  assert.ok(runner.indexOf("requireDisposableEmailRequest();") < runner.indexOf('import("../../src/db/index.ts")'),
    "fail-closed CI environment gate must run before DB imports");
  const handler = readFileSync(receipt.route, "utf8");
  assert.ok(handler.indexOf("verifyPassword(password, account.passwordHash)") <
    handler.indexOf("eq(users.email, email)"), "wrong password must not expose foreign address existence");
  assert.match(handler, /eq\(users.id, user.id\)/);
  assert.match(handler, /eq\(emailChangeTokens.userId, account.id\)/);
  const workflow = readFileSync(p.workflowFile, "utf8");
  for (const marker of ["image: postgres:16", "contents: read", "persist-credentials: false",
    "SMTP_URL=smtp://127.0.0.1:2525", "WORKER_ENABLED=false",
    "node --import tsx scripts/qa/tenant-account-email-request-http.mjs"]) {
    assert.ok(workflow.includes(marker), "workflow safety changed: " + marker);
  }
  assert.equal(manifest.metrics.methods, 498);
  assert.equal(manifest.metrics.publicByDesign, 11);
  assert.ok(manifest.acceptanceStatus.startsWith("NOT ACCEPTED:"));
  assert.ok(manifest.acceptanceStatus.includes(receipt.jobUrl));
  return 1;
}
