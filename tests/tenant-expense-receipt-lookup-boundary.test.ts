import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { receiptReadBindingUnchanged } from "../src/lib/spend-receipt-read-boundary";

const expected = {
  id: 31, organizationId: 17, employeeId: 41,
  receiptStorageKey: "documents/17/41/receipt-abc",
  receiptSha256: "c".repeat(64),
};

test("an own receipt can be returned only if the post-I/O identity and bytes still match", () => {
  assert.equal(receiptReadBindingUnchanged(expected, { ...expected }), true);
  const cases = [
    ["foreign tenant", { ...expected, organizationId: 18 }],
    ["different employee", { ...expected, employeeId: 42 }],
    ["different claim", { ...expected, id: 32 }],
    ["replaced storage object", { ...expected, receiptStorageKey: "documents/17/41/receipt-other" }],
    ["replaced receipt digest", { ...expected, receiptSha256: "a".repeat(64) }],
    ["no stored receipt", { ...expected, receiptStorageKey: null }],
    ["no SHA evidence", { ...expected, receiptSha256: null }],
    ["deleted claim", null],
  ] as const;
  for (const [label, value] of cases) {
    assert.equal(receiptReadBindingUnchanged(expected, value), false, label);
  }
  assert.equal(receiptReadBindingUnchanged({ ...expected, receiptSha256: null }, expected), false);
  assert.equal(receiptReadBindingUnchanged({ ...expected, receiptStorageKey: null }, expected), false);
});

const source = readFileSync("src/app/api/expenses/receipts/route.ts", "utf8");
const lookupStart = source.indexOf("async function findMemberReceiptClaim(");
const lookupEnd = source.indexOf("async function activeReceiptGrant(", lookupStart);
const lookup = source.slice(lookupStart, lookupEnd);
const authStart = source.indexOf("async function authorize(");
const authEnd = source.indexOf("export async function GET(", authStart);
const auth = source.slice(authStart, authEnd);
const getSource = source.slice(source.indexOf("export async function GET("), source.indexOf("export async function POST("));
const postSource = source.slice(source.indexOf("export async function POST("));

test("receipt IDs are looked up only through the caller's active employer membership", () => {
  assert.ok(lookupStart >= 0 && lookupEnd > lookupStart);
  assert.match(lookup, /\.from\(expenseClaims\)/);
  assert.match(lookup, /\.innerJoin\(userOrganizations, and\(/);
  assert.match(lookup, /eq\(userOrganizations\.organizationId, expenseClaims\.organizationId\)/);
  assert.match(lookup, /eq\(userOrganizations\.userId, user\.id\)/);
  assert.match(lookup, /eq\(userOrganizations\.active, true\)/);
  assert.match(lookup, /\.where\(eq\(expenseClaims\.id, id\)\)/);
  for (const handler of [getSource, postSource]) {
    assert.match(handler, /const core = await findMemberReceiptClaim\(user, id\)/);
    assert.match(handler, /if \(!core\) return notFound\(\)/);
    assert.doesNotMatch(handler, /\.from\(expenseClaims\)\.where\(eq\(expenseClaims\.id, id\)\)/);
  }
});

test("foreign, unknown, revoked and out-of-unit receipts share no-store missing-resource denial", () => {
  assert.match(source, /const notFound = \(\) => Response\.json\(\{ error: "Receipt not found\." \}/);
  assert.match(source, /"Cache-Control": "private, no-store"/);
  assert.match(auth, /if \(denied\) return notFound\(\)/);
  assert.match(auth, /if \(!employee\) return notFound\(\)/);
  assert.match(auth, /return scope\.ok \? null : notFound\(\)/);
  assert.match(auth, /const access = await getAccess\(user\.id, claim\.organizationId\)/);
});

test("download authorization is refreshed after object I/O and before return or audit", () => {
  const read = getSource.indexOf("await readVerifiedSpendReceipt(");
  const refreshed = getSource.indexOf("const freshCore = await findMemberReceiptClaim(user, id)");
  const binding = getSource.indexOf("receiptReadBindingUnchanged(claim, freshClaim)");
  const permit = getSource.indexOf("await authorize(user, freshCore)");
  const audit = getSource.indexOf("await recordAuditEvent(");
  const bytes = getSource.indexOf("return new Response(new Uint8Array(bytes)");
  assert.ok(read >= 0 && refreshed > read && binding > refreshed && permit > binding && audit > permit && bytes > audit);
  assert.match(getSource, /freshCore\.organizationId !== core\.organizationId/);
  assert.match(getSource, /freshCore\.employeeId !== core\.employeeId/);
});

test("upload retains two transactional grant checks and no detached foreign write", () => {
  assert.match(postSource, /lockedReceiptGrant\(tx, user, claim\)/);
  assert.match(postSource, /lockedReceiptGrant\(tx, user, freshCore\)/);
  assert.match(postSource, /eq\(expenseClaims\.organizationId, claim\.organizationId\)/);
  assert.match(postSource, /eq\(documents\.organizationId, claim\.organizationId\)/);
  assert.match(postSource, /eq\(expenseClaimEvidence\.organizationId, claim\.organizationId\)/);
  assert.match(postSource, /SPEND_PENDING_RECEIPT_PREFIX/);
});

test("receipt bytes are returned privately and without MIME sniffing", () => {
  assert.match(getSource, /"Cache-Control": "private, no-store"/);
  assert.match(getSource, /"Referrer-Policy": "no-referrer"/);
  assert.match(getSource, /"X-Content-Type-Options": "nosniff"/);
});
