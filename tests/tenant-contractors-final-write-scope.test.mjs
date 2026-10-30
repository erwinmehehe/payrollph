import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const routePath = new URL("../src/app/api/contractors/route.ts", import.meta.url);
const routeBytes = readFileSync(routePath);
const source = routeBytes.toString("utf8");

function handler(method) {
  const start = source.indexOf("export async function " + method + "(request: Request) {");
  assert.ok(start >= 0, method + ": exported handler must still exist");
  const next = source.indexOf("\nexport async function ", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

const scopedFinalWrite = /\.where\(and\(\s*eq\(contractors\.id, id\),\s*eq\(contractors\.organizationId, target\.organizationId\),\s*\)\)\.returning\(/;

test("contractor PATCH and DELETE reassert employer ownership at their final SQL mutations", () => {
  for (const [method, mutation, result] of [
    ["PATCH", "await db.update(contractors)", "row"],
    ["DELETE", "await db.delete(contractors)", "deleted"],
  ]) {
    const body = handler(method);
    const accessAt = body.indexOf("const access = await getAccess(user.id, target.organizationId)");
    const mutationAt = body.indexOf(mutation);
    const missAt = body.indexOf("if (!" + result + ") return Response.json(");
    const successAt = body.lastIndexOf("return Response.json(");
    assert.match(body, /enforceSameOriginMutation\(request\)/);
    assert.match(body, /getSessionUser\(\)/);
    assert.match(body, /assertOrganizationRole\(/);
    assert.match(body, /if \(!access\?\.companyWide\)/);
    assert.ok(accessAt > 0 && mutationAt > accessAt,
      method + ": real company-wide authorization must precede the mutation");
    assert.match(body.slice(mutationAt), scopedFinalWrite,
      method + ": the final SQL must match both the contractor ID and the authorized employer");
    assert.match(body.slice(mutationAt),
      /error: "Contractor changed during authorization\. Retry\.",\s*\}, \{ status: 409 \}/,
      method + ": a missed conditional mutation must fail closed with 409");
    assert.ok(missAt > mutationAt && successAt > missAt,
      method + ": a missed SQL write must not return a success or access a missing row");
  }
  assert.match(handler("DELETE"), /\.returning\(\{ id: contractors\.id \}\)/,
    "DELETE must inspect the actual affected row rather than report an unverified success");
  assert.match(handler("PATCH"), /tin: maskGovernmentId\(row\.tin\)/,
    "PATCH must continue to mask the returned contractor identifier");
});

test("GET and POST retain their original member-verified tenant and encrypted-TIN boundaries", () => {
  const get = handler("GET");
  const post = handler("POST");
  assert.match(get, /eq\(contractors\.organizationId, organizationId\)/);
  assert.match(get, /assertOrganizationRole\(/);
  assert.match(get, /if \(!access\?\.companyWide\)/);
  assert.match(get, /tin: maskGovernmentId\(row\.tin\)/);
  assert.match(post, /assertOrganizationRole\(/);
  assert.match(post, /if \(!access\?\.companyWide\)/);
  assert.match(post, /db\.insert\(contractors\)\.values\(\{\s*organizationId,/);
  assert.match(post, /encryptGovernmentId\(/);
  assert.match(post, /tin: maskGovernmentId\(row\.tin\)/);
});

test("existing MNY-02 credits are preserved without inventing fresh HTTP evidence", () => {
  const manifest = JSON.parse(readFileSync(
    new URL("../scripts/qa/tenant-isolation-coverage-manifest.json", import.meta.url), "utf8"));
  const route = manifest.allApiRouteFiles["src/app/api/contractors/route.ts"];
  assert.ok(route);
  const actualBlob = createHash("sha1")
    .update(Buffer.from("blob " + routeBytes.length + "\0")).update(routeBytes).digest("hex");
  assert.equal(route.gitBlobSha, actualBlob, "changed source must be deliberately re-inventoried");
  assert.deepEqual(route.methods.map((row) => [row.name, row.status]),
    [["GET", "COVERED"], ["POST", "COVERED"], ["PATCH", "COVERED"], ["DELETE", "COVERED"]]);
  for (const method of route.methods) {
    assert.equal(method.testedBy?.file, "scripts/qa/tenant-mny02-contractors-http.mjs");
    assert.ok(Number.isInteger(method.testedBy.ownPositiveLine));
    assert.ok(Number.isInteger(method.testedBy.foreignDenialLine));
    assert.ok(Number.isInteger(method.testedBy.unchangedDbLine));
  }
});
