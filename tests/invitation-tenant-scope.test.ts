import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  canCreateScopedInvitation, invitationVisibleUnit, parseInvitationUnitId,
} from "../src/lib/invitation-tenant-scope";

const companyOwner = { role: "owner", companyWide: true, orgUnitId: null };
const companyAdmin = { role: "admin", companyWide: true, orgUnitId: null };
const unitAdmin = { role: "admin", companyWide: false, orgUnitId: 17 };

test("unit invite selector accepts only canonical Postgres-positive IDs", () => {
  for (const id of [1, "17", 17, 2147483647, "2147483647"]) {
    assert.equal(parseInvitationUnitId(id), Number(id));
  }
  for (const invalid of [undefined, null, true, false, [], [17], {}, 0,
    -1, 1.2, NaN, Infinity, 2147483648, "0", "01", "+17", "-17",
    "17 ", " 17", "1e2", "0x11", "17.0", "2147483648", ""]) {
    assert.equal(parseInvitationUnitId(invalid), null, String(invalid));
  }
});

test("only company-wide grants can see invitations and members from every unit", () => {
  assert.equal(invitationVisibleUnit(companyOwner), null);
  assert.equal(invitationVisibleUnit(companyAdmin), null);
  assert.equal(invitationVisibleUnit(unitAdmin), 17);
  for (const invalid of [null, undefined,
    { role: "admin", companyWide: false, orgUnitId: null },
    { role: "admin", companyWide: false, orgUnitId: 0 },
    { role: "admin", companyWide: true, orgUnitId: 17 }]) {
    assert.equal(invitationVisibleUnit(invalid), undefined);
  }
});

test("unit-scoped administrator cannot create cross-unit, global or privileged invitations", () => {
  assert.equal(canCreateScopedInvitation(unitAdmin, "employee", 17), true);
  for (const id of [null, 18, 99, 0]) {
    assert.equal(canCreateScopedInvitation(unitAdmin, "employee", id), false);
  }
  for (const role of ["owner", "admin", "hr", "payroll", "checker", "bookkeeper"]) {
    assert.equal(canCreateScopedInvitation(unitAdmin, role, 17), false, role);
  }
  assert.equal(canCreateScopedInvitation(
    { role: "bookkeeper", companyWide: false, orgUnitId: 17 }, "admin", 17,
  ), false);
  assert.equal(canCreateScopedInvitation(
    { role: "admin", companyWide: false, orgUnitId: null }, "employee", null,
  ), false);
});

test("company-wide admin retains prior invitations except owner escalation", () => {
  for (const role of ["employee", "admin", "hr", "payroll", "checker", "bookkeeper"]) {
    assert.equal(canCreateScopedInvitation(companyAdmin, role, null), true, role);
    assert.equal(canCreateScopedInvitation(companyOwner, role, 17), true, role);
  }
  assert.equal(canCreateScopedInvitation(companyAdmin, "owner", null), false);
  assert.equal(canCreateScopedInvitation(companyOwner, "owner", null), true);
  assert.equal(canCreateScopedInvitation(
    { role: "owner", companyWide: false, orgUnitId: 17 }, "owner", 17,
  ), false);
});

test("the actual invitation route enforces both SQL read scope and pre-issuance write scope", () => {
  const route = readFileSync("src/app/api/invitations/route.ts", "utf8");
  const get = route.slice(route.indexOf("export async function GET("), route.indexOf("export async function POST("));
  const post = route.slice(route.indexOf("export async function POST("));
  assert.match(get, /invitationVisibleUnit\(access\)/);
  assert.match(get, /eq\(invitations\.orgUnitId, visibleUnit\)/);
  assert.match(get, /eq\(userOrganizations\.orgUnitId, visibleUnit\)/);
  assert.match(get, /Cache-Control": "private, no-store"/);
  assert.match(post, /canCreateScopedInvitation\(access, role, orgUnitId\)/);
  assert.ok(post.indexOf("canCreateScopedInvitation(") < post.indexOf("db.select().from(users)"));
  assert.ok(post.indexOf("canCreateScopedInvitation(") < post.indexOf("createInvitation({"));
  assert.ok(post.indexOf("canCreateScopedInvitation(") < post.indexOf("queueMessage({"));
  assert.ok(post.indexOf("eq(orgUnits.organizationId, organizationId)") < post.indexOf("createInvitation({"));
  assert.match(post, /assertOrganizationRole\(\s*user\.id,\s*organizationId,\s*ORG_ADMIN_ROLES/);
});
