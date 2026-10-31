import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/bir/annual-employer/candidate/route.ts", "utf8");
const runner = readFileSync("scripts/qa/tenant-bir1604c-candidate-post-http.mjs", "utf8");
const workflow = readFileSync(".github/workflows/bir-1604c-candidate-qa.yml", "utf8");

test("Protected BIR candidate POST always checks signed-in employer and legal-entity resource", () => {
  const post = route.split("export async function POST")[1];
  for (const token of [
    'enforceSameOriginMutation(request)', 'getSessionUser()',
    'criticalReleaseFlagEnabled("bir1604cReviewedCandidate")',
    'requireSensitiveActionMfa(user)',
    'assertOrganizationRole(', 'access?.companyWide',
    'assertBirAnnualEntityAccess(user.id, body.organizationId, body.legalEntityId, request)',
    'loadBirAnnualEmployerSource(', 'body.sourceDigest !== source.reconciliation.sourceDigest',
    '"Cache-Control": "private, no-store"',
  ]) assert.ok(post.includes(token) || route.includes(token),
    "Missing source-bound BIR candidate protection: " + token);
});

test("Extended actual PG16 BIR test is additive, two-attacker and zero-credit", () => {
  for (const token of [
    '["BIR_SYNTHETIC_BROWSER_QA", "true"]',
    '["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/app_db"]',
    'for (const name of ["ATTA", "ATTB", "VICTIM"])',
    'victim.entity.id > b.entity.id',
    'result.records[0]?.employeeNo === e.worker.employeeNo',
    'legalEntityId: victim.entity.id',
    'await snapshot(e), before.get(e.org.id)',
    'owned === 3 && denied === 4',
    'acceptedByBIR: false',
    'credits: 0',
  ]) assert.ok(runner.includes(token), "Missing BIR tenant proof control: " + token);
  assert.ok(workflow.includes("node --import tsx scripts/qa/tenant-bir1604c-candidate-post-http.mjs"));
  assert.ok(workflow.includes("node --import tsx scripts/bir-1604c-synthetic-browser.mjs"),
    "Previously accepted synthetic feature/browser acceptance must remain intact");
  assert.ok(workflow.includes("image: postgres:16"));
});
