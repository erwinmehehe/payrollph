import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/app/api/assets/route.ts", import.meta.url), "utf8");

test("asset PATCH and DELETE reassert unit-scoped custody at the final write", () => {
  const patch = source.slice(source.indexOf("export async function PATCH"), source.indexOf("export async function DELETE"));
  const remove = source.slice(source.indexOf("export async function DELETE"));
  for (const [method, block] of [["PATCH", patch], ["DELETE", remove]]) {
    assert.match(block, /assertOrganizationRole\(/, method + " must authorize role");
    assert.match(block, /assertScope\(/, method + " must check employee unit");
    assert.match(block, /eq\(assets\.organizationId, target\.organizationId\)/, method + " must scope by tenant");
    assert.match(block, /\.\.\.\(access\.companyWide \? \[\] : \[eq\(assets\.employeeId, target\.employeeId!\)\]\)/,
      method + " must reject a stale unit-scoped employee assignment");
    assert.match(block, /if \(!\w+\) return Response\.json\(\{ error: "Asset changed during authorization\. Retry\." \}, \{ status: 409 \}\)/,
      method + " must fail closed when the conditional write misses");
  }
});

test("asset writes remain guarded by same-origin and session checks", () => {
  for (const method of ["PATCH", "DELETE"]) {
    const block = source.slice(source.indexOf("export async function " + method));
    assert.match(block, /enforceSameOriginMutation\(request\)/);
    assert.match(block, /getSessionUser\(\)/);
    assert.match(block, /itManagedDevices\.organizationId/);
  }
});
