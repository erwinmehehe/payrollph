import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const route = readFileSync(resolve("src/app/api/hcm/salary-corrections/cases/route.ts"), "utf8");
const cases = readFileSync(resolve("src/lib/hcm-salary-correction-cases.ts"), "utf8");

test("case GET resolves employer access and filters rows at the database query", () => {
  assert.match(route, /requested: new URL\(request\.url\)\.searchParams\.get\("legalEntityId"\)/);
  assert.match(route, /entityScope\.context\.enabled \? entityScope\.context\.legalEntityId : null/);
  assert.match(cases, /eq\(salaryCorrectionCases\.legalEntityId, legalEntityId\)/);
  assert.match(route, /entityScope\.context\.group \|\| entityScope\.context\.legalEntityId === null/);
});

test("case creation and every PATCH action bind actual legal-employer authorization", () => {
  assert.match(route, /requested: input\.legalEntityId/);
  assert.match(route, /assertEntityResource\(entityScope\.context, input\.legalEntityId\)/);
  assert.match(route, /requested: body\.legalEntityId as string \| number \| null \| undefined/);
  assert.match(route, /eq\(salaryCorrectionCases\.organizationId, organizationId\), eq\(salaryCorrectionCases\.id, caseId\)/);
  assert.match(route, /assertEntityResource\(entityScope\.context, caseEmployer\.legalEntityId\)/);
});

test("idempotent replay and cancellation cannot be performed by another maker", () => {
  assert.match(cases, /existing\.requestedByUserId === actor\.id/);
  assert.match(cases, /existing\.legalEntityId === input\.legalEntityId/);
  assert.match(cases, /existing\.evidenceReference === input\.evidenceReference/);
  assert.match(cases, /correction\.requestedByUserId !== actor\.id\) fail\("NOT_CASE_MAKER"/);
});
