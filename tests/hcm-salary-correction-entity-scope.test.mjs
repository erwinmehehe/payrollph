import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const route = readFileSync(resolve("src/app/api/hcm/salary-corrections/cases/route.ts"), "utf8");
const cases = readFileSync(resolve("src/lib/hcm-salary-correction-cases.ts"), "utf8");

test("case GET preserves missing selectors as absent while filtering actual authorized employer", () => {
  const get = route.split("export async function GET(request: Request) {")[1]
    ?.split("async function guardMutation")[0];
  assert.ok(get, "GET handler must exist");
  assert.match(get, /resolveMultiEntityContext\(\{\s*userId: user\.id, organizationId, request,\s*\}\)/);
  assert.doesNotMatch(get, /requested:\s*new URL/);
  assert.match(get, /entityScope\.context\.enabled \? entityScope\.context\.legalEntityId : null/);
  assert.match(cases, /eq\(salaryCorrectionCases\.legalEntityId, legalEntityId\)/);
  assert.match(get, /entityScope\.context\.group \|\| entityScope\.context\.legalEntityId === null/);
});

test("case creation and every PATCH action bind actual legal-employer authorization", () => {
  assert.match(route, /requested: input\.legalEntityId/);
  assert.match(route, /assertEntityResource\(entityScope\.context, input\.legalEntityId\)/);
  assert.match(route, /requested: body\.legalEntityId as string \| number \| null \| undefined/);
  const patch = route.split("export async function PATCH(request: Request) {")[1];
  assert.ok(patch, "PATCH handler must exist");
  assert.match(patch, /const caseScope = and\(/);
  assert.match(patch, /eq\(salaryCorrectionCases\.organizationId, organizationId\)/);
  assert.match(patch, /eq\(salaryCorrectionCases\.id, caseId\)/);
  assert.match(patch, /eq\(salaryCorrectionCases\.legalEntityId, entityScope\.context\.legalEntityId!\)/);
  assert.match(patch, /\.where\(caseScope\)/);
  assert.match(patch, /if \(!caseEmployer\) return Response\.json\(\{ error: "Correction case not found\." \}/);
  assert.match(patch, /assertEntityResource\(entityScope\.context, caseEmployer\.legalEntityId\)/);
  assert.ok(patch.indexOf("const caseScope = and(") < patch.indexOf("switch (action)"),
    "Every case mutation must resolve the authorized employer before running an action");
});

test("idempotent replay and cancellation cannot be performed by another maker", () => {
  assert.match(cases, /existing\.requestedByUserId === actor\.id/);
  assert.match(cases, /existing\.legalEntityId === input\.legalEntityId/);
  assert.match(cases, /existing\.evidenceReference === input\.evidenceReference/);
  assert.match(cases, /correction\.requestedByUserId !== actor\.id\) fail\("NOT_CASE_MAKER"/);
});
