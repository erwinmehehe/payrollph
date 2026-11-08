import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assertHiddenGrant, assertForeignEqualsMissing, assertOwnedGrantEnded,
} from "../scripts/qa/tenant-de-minimis-delete-contract.mjs";

const source = readFileSync(new URL("../src/app/api/de-minimis/route.ts", import.meta.url), "utf8");
const helper = source.slice(source.indexOf("async function findActiveMemberGrant("),
  source.indexOf("export async function GET("));
const del = source.slice(source.indexOf("export async function DELETE("));
const no = (id = 404, body = '{"error":"Grant not found."}', headers = new Headers()) => ({
  status: id, text: body, json: JSON.parse(body), headers,
});
const own = { id: 7, organizationId: 3, employeeId: 12, benefitType: "fictional-rice",
  amount: "100.00", frequency: "monthly", active: true, endedOn: null };
const peer = { ...own, id: 8, benefitType: "fictional-uniform" };
const before = { grants: [own, peer], audit: [] };
function end({ audit = true, other = false, active = false } = {}) {
  const after = structuredClone(before);
  after.grants[0].active = active;
  after.grants[0].endedOn = "2040-01-10";
  if (other) after.grants[1].amount = "999.00";
  if (audit) after.audit.push({ organizationId: 3, actor: "Fictional owner",
    action: "De minimis benefit ended", resource: "fictional-rice grant 7" });
  return after;
}
const response = { status: 200, json: { ok: true } };
const args = { id: 7, organizationId: 3, actor: "Fictional owner" };

test("DELETE first resolves grant through the caller's active tenant membership", () => {
  assert.match(helper, /select\(\{ grant: deMinimisGrants \}\)/);
  assert.match(helper, /innerJoin\(userOrganizations, and\(/);
  assert.match(helper, /eq\(userOrganizations\.userId, userId\)/);
  assert.match(helper, /eq\(userOrganizations\.organizationId, deMinimisGrants\.organizationId\)/);
  assert.match(helper, /eq\(userOrganizations\.active, true\)/);
  assert.match(helper, /eq\(deMinimisGrants\.id, grantId\)/);
  assert.match(del, /findActiveMemberGrant\(user\.id, id\)/);
  assert.doesNotMatch(del, /db\.select\(\)\.from\(deMinimisGrants\)/);
  assert.ok(del.indexOf("findActiveMemberGrant(user.id, id)") <
    del.indexOf("assertOrganizationRole("), "lookup must precede role checks");
});
test("DELETE rejects invalid selectors and scopes the final update to employer and ID", () => {
  assert.match(del, /Number\.isSafeInteger\(id\) \|\| id <= 0/);
  assert.match(del, /enforceSameOriginMutation\(request\)/);
  assert.match(del, /eq\(deMinimisGrants\.id, id\)/);
  assert.match(del, /eq\(deMinimisGrants\.organizationId, grant\.organizationId\)/);
});
test("foreign and absent IDs have the same non-revealing 404 response", () => {
  assert.doesNotThrow(() => assertForeignEqualsMissing(no(), no(), ["VICTIM"]));
  assert.throws(() => assertForeignEqualsMissing(no(403, '{"error":"Forbidden"}'), no()), /must be 404/);
  assert.throws(() => assertForeignEqualsMissing(no(200, '{"ok":true}'), no()), /must be 404/);
  assert.throws(() => assertForeignEqualsMissing(no(404, '{"error":"Different error"}'), no()),
    /deep-equal|Expected values/);
});
test("a denied response may not disclose victim markers in body or headers", () => {
  assert.throws(() => assertHiddenGrant(no(404, '{"error":"VICTIM"}'), ["VICTIM"]),
    /deep-equal|Expected values/);
  assert.throws(() => assertHiddenGrant(no(404, '{"error":"Grant not found."}',
    new Headers({ "x-tenant": "VICTIM" })), ["VICTIM"]), /denial header exposed/);
});
test("actual owned soft end with matching audit passes", () => {
  assert.doesNotThrow(() => assertOwnedGrantEnded(before, end(), response, args));
});
test("status-only success or omitted audit cannot count as proof", () => {
  assert.throws(() => assertOwnedGrantEnded(before, end({ active: true }), response, args),
    /grant must become inactive/);
  assert.throws(() => assertOwnedGrantEnded(before, end({ audit: false }), response, args),
    /exactly one employer audit/);
});
test("cross-tenant or collateral changes invalidate the proof", () => {
  assert.throws(() => assertOwnedGrantEnded(before, end({ other: true }), response, args),
    /other owned benefit grants/);
  const forged = end(); forged.grants[0].organizationId = 99;
  assert.throws(() => assertOwnedGrantEnded(before, forged, response, args),
    /Expected values|strictly equal/);
  const wrongAudit = end(); wrongAudit.audit[0].organizationId = 99;
  assert.throws(() => assertOwnedGrantEnded(before, wrongAudit, response, args),
    /Expected values|strictly equal/);
});
