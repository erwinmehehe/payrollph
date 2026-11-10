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
    'owned === 3 && ownedChecks === 3 && ownedDownloads === 3',
    'denied === 16',
    'for (let pad = 0; pad < 6; pad++)',
    'victim.org.id > 6 && victim.worker.id > 6 && victim.entity.id > 6',
    'for (const mode of ["template", "check", "download"])',
    'bodyFor(attacker, mode, victim)',
    'data: { ...bodyFor(attacker, mode), legalEntityId: victim.entity.id }',
    'employeeNo: victim.worker.employeeNo',
    'assert.deepEqual(await snapshot(victim), before.get(victim.org.id)',
    'assert.deepEqual(await snapshot(attacker), before.get(attacker.org.id)',
    'actualSha === checkResult.fileSha256',
    'afterDownload.audit.length === beforeCheck.audit.length + 1',
    'realOwnChecks: ownedChecks',
    'realOwnDraftDownloads: ownedDownloads',
    'allThreeModesExercised: true',
    'acceptedByBIR: false',
    'credits: 0',
  ]) assert.ok(runner.includes(token), "Missing BIR tenant proof control: " + token);
  assert.ok(workflow.includes("node --import tsx scripts/qa/tenant-bir1604c-candidate-post-http.mjs"));
  assert.ok(workflow.includes("node --import tsx scripts/bir-1604c-synthetic-browser.mjs"),
    "Previously accepted synthetic feature/browser acceptance must remain intact");
  assert.ok(workflow.includes("image: postgres:16"));
});

test("Protocol refusals on the same method are exercised for every accepted action and write nothing", () => {
  const post = route.split("export async function POST")[1];
  // The route must actually contain each refusal the proof claims to exercise.
  for (const token of ['"Authentication required."', 'code: "INVALID_REVIEW"', 'code: "STALE_SOURCE"', "enforceSameOriginMutation(request)"])
    assert.ok(post.includes(token), "Route lost a refusal the proof relies on: " + token);
  for (const token of [
    'let refusals = 0;',
    'const anonymous = await request.newContext({',
    '"sec-fetch-site": "cross-site", origin: "https://attacker.example"',
    'records: "not-an-array"',
    'sourceDigest: "0".repeat(64)',
    'mode: "export"',
    '401, "Anonymous caller cannot "',
    '403, "A cross-site mutation cannot "',
    '400, "A malformed "',
    '409, "A stale source digest cannot produce a review template"',
    'check(refusals === 22,',
    'protocolRefusals: refusals',
    'Protocol refusals must not change the attacker\'s own source, annual rows or audit',
    'Protocol refusals must not touch the victim',
  ]) assert.ok(runner.includes(token), "Missing protocol-refusal control: " + token);
});

test("All candidate POST modes require the real accepted path, not only template denial", () => {
  for (const mode of ['"template"', '"check"', '"download"'])
    assert.ok(route.includes(mode), "Missing accepted BIR action " + mode);
  assert.ok(runner.includes('const candidateBytes = await downloaded.body()'),
    "Download must inspect actual draft DAT bytes");
  assert.ok(runner.includes('const checkResult = await checked.json()'),
    "Check must exercise real HTTP with real current source digest");
  assert.ok(runner.includes('for (const attacker of [a, b])'),
    "Two independent own employers must be tested");
  assert.ok(runner.includes('if (mode !== "template")'),
    "Foreign employee selector refusal must cover check/download");
  assert.ok(!runner.includes('realOwnChecks: 0') && !runner.includes('realOwnDraftDownloads: 0'),
    "No hardcoded fake coverage counters");
});
