import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const path = "src/app/api/expenses/receipts/route.ts";
const read = () => readFileSync(path, "utf8");

function assertReceiptBoundary(source) {
  assert.match(source, /receiptGrantMatches\(/, "worker/employer grant predicate required");
  assert.match(source, /eq\(employees\.id, claim\.employeeId\)/);
  assert.match(source, /eq\(employees\.organizationId, claim\.organizationId\)/);
  assert.match(source, /eq\(userOrganizations\.userId, user\.id\)/);
  assert.match(source, /eq\(userOrganizations\.organizationId, claim\.organizationId\)/);
  assert.match(source, /eq\(userOrganizations\.active, true\)/);
  assert.match(source, /for\("share"\)\.limit\(1\)/,
    "committing transactions must lock the employee and current grant");

  const get = source.indexOf("export async function GET(");
  const post = source.indexOf("export async function POST(");
  assert.ok(get >= 0 && post > get);
  const getBody = source.slice(get, post);
  const postBody = source.slice(post);
  assert.match(getBody, /const readDenied = await authorize\(user, core\);/,
    "recheck access after object storage read, before private bytes are returned");
  assert.ok(getBody.indexOf("const readDenied = await authorize") <
    getBody.indexOf("return new Response(new Uint8Array(bytes)"),
    "download may not escape before the second employee grant check");
  assert.ok(source.indexOf("return await activeReceiptGrant(user, claim) ? null : notFound();") <
    get, "employee paths must be bound before any GET/POST workflow");

  const stage = postBody.indexOf("if (!liveClaim || !await lockedReceiptGrant(tx, user, claim))");
  const intent = postBody.indexOf("const [intent] = await tx.insert(documents)");
  assert.ok(stage >= 0 && intent > stage,
    "staging an upload must wait for current worker grant and claim identity");
  assert.match(postBody.slice(stage, intent), /RECEIPT_GRANT_CHANGED/);
  const final = postBody.indexOf("if (!await lockedReceiptGrant(tx, user, freshCore))");
  const attached = postBody.indexOf("tx.update(expenseClaimEvidence)");
  assert.ok(final > intent && attached > final,
    "final commit must re-check the locked employee grant after storage IO");
  const reassignmentGuard = postBody.indexOf("freshCore.employeeId !== claim.employeeId");
  assert.ok(reassignmentGuard > 0 && reassignmentGuard < final,
    "claim reassignment while uploading must not attach a mismatched employee");
  assert.match(postBody, /eq\(expenseClaimEvidence\.organizationId, claim\.organizationId\)/);
  assert.match(postBody, /reconcilePendingSpendReceipt\(pendingDocumentId\)/,
    "failed final attachment must retain existing recoverable storage cleanup");
}

test("receipt GET/POST use same-employer worker grants and transaction rechecks", () => {
  assertReceiptBoundary(read());
});

test("source negative controls reject removed download, staging or commit boundaries", () => {
  const original = read();
  for (const needle of [
    "const readDenied = await authorize(user, core);",
    "if (!liveClaim || !await lockedReceiptGrant(tx, user, claim))",
    "if (!await lockedReceiptGrant(tx, user, freshCore))",
    "freshCore.employeeId !== claim.employeeId",
    "eq(userOrganizations.active, true)",
  ]) {
    assert.ok(original.includes(needle));
    assert.throws(() => assertReceiptBoundary(original.replaceAll(needle, "/* missing guard */")),
      undefined, "removing " + needle + " must fail the guard");
  }
});

test("receipt methods stay GAP without independent real PG16 HTTP acceptance", () => {
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const record = manifest.allApiRouteFiles[path];
  assert.deepEqual(record.methods.map(item => item.name).sort(), ["GET", "POST"]);
  for (const method of record.methods) {
    assert.equal(method.status, "GAP");
    assert.equal(method.testedBy, null);
    assert.equal(method.reviewedUncertified?.coverageCredits, 0);
    assert.equal(method.reviewedUncertified?.realHttpPg16Proven, false);
    assert.equal(method.reviewedUncertified?.independentSecurityReview, "PENDING");
  }
});
