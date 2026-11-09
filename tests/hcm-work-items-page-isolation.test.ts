import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseHcmWorkItemsEmployerId } from "../src/lib/hcm-work-items-page-tenancy";

const page = readFileSync("src/app/hcm/work-items/page.tsx", "utf8");
const client = readFileSync("src/components/hcm-work-queue.tsx", "utf8");
const api = readFileSync("src/app/api/hcm/work-items/route.ts", "utf8");

test("work queue page accepts only a canonical, single, positive employer id", () => {
  assert.equal(parseHcmWorkItemsEmployerId("1"), 1);
  assert.equal(parseHcmWorkItemsEmployerId("42"), 42);
  assert.equal(parseHcmWorkItemsEmployerId(String(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
  const invalid: Array<string | string[] | undefined> = [
    undefined, "", "0", "-1", "01", "+1", "1.0", "1e3",
    " 1", "1 ", "1&organizationId=2", "NaN",
    String(Number.MAX_SAFE_INTEGER + 1), ["1"], ["1", "2"],
  ];
  for (const selector of invalid) {
    assert.equal(parseHcmWorkItemsEmployerId(selector), null, JSON.stringify(selector));
  }
});

test("work queue page authorizes the requested employer before client render", () => {
  assert.ok(!page.startsWith('"use client"'), "page must be a server component");
  assert.ok(page.includes('redirect("/login")'));
  assert.ok(page.includes("parseHcmWorkItemsEmployerId((await searchParams).organizationId)"));
  assert.ok(page.includes("if (!organizationId) notFound()"));
  const roleGate = page.indexOf("await assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES)");
  const roleDenied = page.indexOf("if (denied) notFound()");
  const accessGate = page.indexOf("await getAccess(user.id, organizationId)");
  const scopeDenied = page.indexOf("if (!access?.companyWide) notFound()");
  const hydrate = page.indexOf("<HcmWorkQueue");
  assert.ok(roleGate > 0 && roleGate < roleDenied && roleDenied < accessGate &&
    accessGate < scopeDenied && scopeDenied < hydrate,
  "role, session-policy, permission and company-wide scope must be checked before the client mounts");
  assert.ok(page.includes("key={organizationId} authorizedOrganizationId={organizationId}"));
  assert.ok(!page.includes("primaryCompanyOrganizationId"), "no fallback employer");
});

test("client cannot edit or infer the employer from untrusted browser state", () => {
  assert.ok(client.startsWith('"use client"'));
  assert.ok(client.includes("authorizedOrganizationId: number"));
  assert.ok(client.includes("const organizationId = String(authorizedOrganizationId)"));
  assert.ok(!client.includes("setOrganizationId"));
  assert.ok(!client.includes("window.location"));
  assert.ok(!client.includes('aria-label="Organization ID"'));
  assert.ok(client.includes("isVerifiedHcmWorkQueueResponse(data, Number(organizationId))"));
  assert.ok(client.includes("key={JSON.stringify([organizationId, filter])}"));
});

test("work queue GET and PATCH retain independent authorization and tenant-filtered SQL", () => {
  assert.ok(api.includes("assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES)"));
  assert.ok(api.includes("if (!access?.companyWide)"));
  assert.equal((api.match(/const auth = await authorize\(organizationId\)/g) ?? []).length, 2,
    "both GET and PATCH must authorize each request");
  assert.ok(api.includes("WHERE c.organization_id = $1"));
  assert.ok(api.includes("WHERE organization_id = $1 AND id = $2 FOR UPDATE"));
  assert.ok(api.includes("WHERE organization_id=$1 AND id=$2 RETURNING *"));
  assert.ok(api.includes("uo.organization_id = $2"), "owner changes must stay within the selected employer");
});
