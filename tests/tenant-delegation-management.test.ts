import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { uniqueDelegationMember } from "../src/lib/delegation-members";

type Member = { id: number; name: string; role: string; orgUnitId: number | null };

const a: Member[] = [
  { id: 11, name: "Alex Checker", role: "checker", orgUnitId: null },
  { id: 12, name: "Maria Reviewer", role: "owner", orgUnitId: null },
];
const b: Member[] = [
  { id: 21, name: "Alex Checker", role: "checker", orgUnitId: null },
  { id: 22, name: "Other Employer", role: "owner", orgUnitId: null },
];
const c: Member[] = [{ id: 31, name: "Alex Checker", role: "checker", orgUnitId: null }];

test("three independently scoped employer lists resolve only their own active identities", () => {
  assert.equal(uniqueDelegationMember(a, " alex checker ")?.id, 11);
  assert.equal(uniqueDelegationMember(b, "ALEX CHECKER")?.id, 21);
  assert.equal(uniqueDelegationMember(c, "Alex Checker")?.id, 31);
  assert.equal(uniqueDelegationMember(a, "Other Employer"), null);
});

test("ambiguous same-employer names fail closed, regardless of role", () => {
  const ambiguous = [...a, { id: 13, name: " ALEX CHECKER ", role: "owner", orgUnitId: 7 }];
  assert.equal(uniqueDelegationMember(ambiguous, "alex checker"), null);
  assert.equal(uniqueDelegationMember(ambiguous, "Maria Reviewer")?.id, 12);
  assert.equal(uniqueDelegationMember(a, ""), null);
  assert.equal(uniqueDelegationMember([], "Alex Checker"), null);
});

test("unit-filtered lists cannot nominate an out-of-unit delegate", () => {
  const unitOne = [
    { id: 11, name: "Source", role: "manager", orgUnitId: 1 },
    { id: 12, name: "Delegate", role: "manager", orgUnitId: 2 },
  ].filter((member) => member.orgUnitId === 1);
  assert.equal(uniqueDelegationMember(unitOne, "Source")?.id, 11);
  assert.equal(uniqueDelegationMember(unitOne, "Delegate"), null);
});

const route = readFileSync(new URL("../src/app/api/delegations/route.ts", import.meta.url), "utf8");

test("GET and POST use tenant-qualified active memberships and unique actor names", () => {
  assert.match(route, /async function activeDelegationMembers\(organizationId: number\)/);
  assert.match(route, /eq\(userOrganizations.organizationId, organizationId\)/);
  assert.match(route, /eq\(userOrganizations.active, true\)/);
  assert.match(route, /eq\(users.active, true\)/);
  const get = route.split("export async function GET")[1].split("export async function POST")[0];
  const post = route.split("export async function POST")[1].split("export async function PATCH")[0];
  assert.match(get, /uniqueDelegationMember\(await activeDelegationMembers\(organizationId\), user.name\)/);
  assert.match(post, /const members = await activeDelegationMembers\(organizationId\)/);
  assert.match(post, /uniqueDelegationMember\(visibleMembers, fromApprover\)/);
  assert.match(post, /uniqueDelegationMember\(visibleMembers, toApprover\)/);
  assert.match(post, /roleAllowed\(toUser.role, PAYROLL_CHECKER_ROLES\)/);
});

test("PATCH scopes the lookup before role gating and revalidates active participants", () => {
  const patch = route.split("export async function PATCH")[1];
  assert.match(patch, /\.innerJoin\(userOrganizations, and\(/);
  assert.match(patch, /eq\(userOrganizations.organizationId, approvalDelegations.organizationId\)/);
  assert.match(patch, /eq\(userOrganizations.userId, user.id\)/);
  assert.match(patch, /eq\(userOrganizations.active, true\)/);
  assert.ok(patch.indexOf("if (!target) return delegationNotFound();") <
    patch.indexOf("const denied = await assertOrganizationRole("));
  assert.match(patch, /if \(!canAdminister && fromUser\?\.id !== user.id\)/);
  assert.match(patch, /if \(body.active\) \{/);
  assert.match(patch, /!roleAllowed\(toUser.role, PAYROLL_CHECKER_ROLES\)/);
  assert.match(patch, /\.where\(and\(eq\(approvalDelegations.id, id\), eq\(approvalDelegations.organizationId, target.organizationId\)\)\)/);
});
