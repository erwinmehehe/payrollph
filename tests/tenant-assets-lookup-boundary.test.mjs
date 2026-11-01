import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/app/api/assets/route.ts", import.meta.url), "utf8");
const helper = source.slice(
  source.indexOf("async function findMemberAsset("),
  source.indexOf("export async function GET(request: Request)"),
);
const patch = source.slice(
  source.indexOf("export async function PATCH(request: Request)"),
  source.indexOf("export async function DELETE(request: Request)"),
);
const remove = source.slice(source.indexOf("export async function DELETE(request: Request)"));

test("asset mutation ID lookup joins a real active employer membership, not a global asset lookup", () => {
  assert.ok(helper.startsWith("async function findMemberAsset("));
  assert.match(helper, /\.select\(\{ asset: assets \}\)/);
  assert.match(helper, /\.innerJoin\(userOrganizations, and\(/);
  assert.match(helper, /eq\(userOrganizations\.userId, userId\)/);
  assert.match(helper, /eq\(userOrganizations\.organizationId, assets\.organizationId\)/);
  assert.match(helper, /eq\(userOrganizations\.active, true\)/);
  assert.match(helper, /\.where\(eq\(assets\.id, assetId\)\)/);
  assert.match(helper, /return match\?\.asset \?\? null;/);
});

test("PATCH and DELETE hide real foreign IDs exactly like missing IDs before role or custody checks", () => {
  for (const [method, block] of [["PATCH", patch], ["DELETE", remove]]) {
    const lookup = block.indexOf("const target = await findMemberAsset(user.id, id);");
    const deny = block.indexOf('if (!target) return Response.json({ error: "Asset not accessible." }, { status: 403 });');
    const role = block.indexOf("const denied = await assertOrganizationRole(");
    assert.ok(lookup > 0 && deny > lookup && role > deny, method + " must resolve tenant membership first");
    assert.doesNotMatch(block, /from\(assets\)\.where\(eq\(assets\.id, id\)\)/);
    assert.match(block, /enforceSameOriginMutation\(request\)/);
    assert.match(block, /getSessionUser\(\)/);
    assert.match(block, /eq\(assets\.organizationId, target\.organizationId\)/);
    assert.match(block, /eq\(itManagedDevices\.organizationId, target\.organizationId\)/);
  }
});

test("listed/created assets remain bound to explicit employer and valid employee scope", () => {
  const get = source.slice(source.indexOf("export async function GET("), source.indexOf("export async function POST("));
  const post = source.slice(source.indexOf("export async function POST("), source.indexOf("export async function PATCH("));
  assert.match(get, /eq\(assets\.organizationId, organizationId\)/);
  assert.match(get, /eq\(employees\.organizationId, organizationId\)/);
  assert.match(post, /eq\(employees\.organizationId, organizationId\)/);
  assert.match(post, /assertScope\(access, employee\.orgUnitId\)/);
  assert.match(post, /\.insert\(assets\)\.values\(\{\s*organizationId,/);
});
