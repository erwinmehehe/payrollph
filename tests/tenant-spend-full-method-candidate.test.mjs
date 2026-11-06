import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const ROUTE = "src/app/api/spend/route.ts";
const HARNESS = "scripts/qa/tenant-spend-write-actions-http.mjs";
const WORKFLOW = ".github/workflows/tenant-spend-write-actions-http.yml";
const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
const EXPECTED = Object.freeze({
  [ROUTE]: "7a5d067830b7f7a754a00ee1cad294081c3f8e19",
  [HARNESS]: "25d7f4710ab96e9f8f224e56930b18d7e9b74bed",
});

const source = path => readFileSync(path, "utf8");
function gitBlob(path) {
  const bytes = readFileSync(path);
  return createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
}

test("Spend write proof cannot borrow the historical GET credit or claim unreviewed method coverage", () => {
  for (const [path, sha] of Object.entries(EXPECTED)) {
    assert.equal(gitBlob(path), sha, path + ": source drift requires new exact-head real-HTTP evidence");
  }
  const manifest = JSON.parse(source(MANIFEST));
  const entry = manifest.allApiRouteFiles[ROUTE];
  assert.equal(entry.gitBlobSha, EXPECTED[ROUTE]);
  assert.deepEqual(entry.methods.map(method => [method.name, method.status]),
    [["GET", "COVERED"], ["POST", "GAP"], ["PATCH", "GAP"]]);
  for (const method of entry.methods.filter(method => method.name !== "GET")) {
    assert.equal(method.testedBy, null, "no unearned write-method credit");
  }
  assert.equal(manifest.metrics.coveredAfter + manifest.metrics.publicByDesign + manifest.metrics.gap,
    manifest.metrics.methods);
  assert.match(manifest.acceptanceStatus, /^NOT ACCEPTED:/);
});

test("POST and PATCH code preserve all four write actions, row access and independent checker gates", () => {
  const route = source(ROUTE);
  assert.match(route, /export async function POST\(request: Request\)/);
  assert.match(route, /export async function PATCH\(request: Request\)/);
  assert.match(route, /const context = await auth\(user\.id, organizationId\)/);
  for (const action of ["category_policy", "card", "transaction", "report"]) {
    assert.ok(route.includes('if (action === "' + action + '")'),
      "missing entire POST method action: " + action);
  }
  assert.match(route, /eq\(employees\.organizationId, organizationId\), eq\(employees\.id, employeeId\)/);
  assert.match(route, /eq\(spendCards\.id, cardId\), eq\(spendCards\.organizationId, organizationId\)/);
  assert.match(route, /eq\(expenseClaims\.organizationId, organizationId\), inArray\(expenseClaims\.id, claimIds\), eq\(expenseClaims\.employeeId, employeeId\)/);
  assert.match(route, /if \(existing\.submittedByUserId === user\.id\)/);
  assert.match(route, /eq\(expenseReports\.id, id\), eq\(expenseReports\.organizationId, existing\.organizationId\), eq\(expenseReports\.status, "submitted"\)/);
  assert.match(route, /eq\(expenseClaims\.organizationId, existing\.organizationId\), eq\(expenseClaims\.employeeId, existing\.employeeId\)/);
  assert.match(route, /await tx\.insert\(auditEvents\)\.values/);
  assert.match(route, /await loadSpendClaimEvidence\(tx, coreClaims\)/);
});

test("disposable real-HTTP proof exercises every own method action and real foreign objects", () => {
  const script = source(HARNESS);
  for (const phrase of [
    'for (const label of ["ATTA", "ATTB", "VICTIM"])',
    'for (const own of [a,b])',
    '"category_policy"', '"card"', '"transaction"', '"report"',
    '"approved"', '"rejected"',
    "foreign category review", "foreign card registration",
    "foreign card transaction", "foreign expense report",
    "forged victim employee", "forged foreign card", "forged victim claim",
    "foreign report decision", "forged employer in victim report decision",
    "maker-checker separation", "own independent approval", "own independent rejection",
    "v.approveClaim.id > own.approveClaim.id",
    "v.rejectReport.id > own.rejectReport.id",
    "assert.deepEqual(await state(v.actor.org.id), victimBefore",
    "assert.deepEqual(await state(other.actor.org.id), otherBefore",
    "methodCredits: 0",
  ]) assert.ok(script.includes(phrase), "missing substantive Spend proof: " + phrase);
  assert.match(script, /const \[a,b,v\] = employers/);
  assert.match(script, /await denied\(own, "POST"[\s\S]*?403, "foreign/);
  assert.match(script, /await denied\(own, "PATCH"[\s\S]*?403, "foreign report decision"/);
  assert.match(script, /await db\.insert\(s\.expenseReportItems\)\.values/);
  assert.match(script, /await fixture\.seedEmployer\(label, nonce, fixture\.standaloneMakeSession\)/);
  assert.match(script, /await db\.insert\(s\.userOrganizations\)\.values/);
});

test("strict environment gate precedes database import; PG16 workflow has no provider or deployment action", () => {
  const script = source(HARNESS);
  const wf = source(WORKFLOW);
  assert.ok(script.indexOf("requireDisposable();") < script.indexOf('import("../../src/db/index.ts")'),
    "CI-only refusal must happen before DB modules load");
  assert.match(script, /DATABASE_URL: "postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\/app_db"/);
  assert.match(script, /SPEND_PAYROLL_REIMBURSEMENTS_ENABLED: "true"/);
  assert.match(script, /GITHUB_ACTIONS: "true"/);
  assert.match(wf, /image: postgres:16/);
  assert.match(wf, /npm start -- -H 127\.0\.0\.1/);
  assert.match(wf, /node --import tsx scripts\/qa\/tenant-spend-write-actions-http\.mjs/);
  assert.match(wf, /node --test tests\/tenant-spend-full-method-candidate\.test\.mjs/);
  assert.match(wf, /XENDIT_PAYOUTS_ENABLED=false/);
  assert.match(wf, /PAYMONGO_DISBURSEMENTS_ENABLED=false/);
  assert.match(wf, /CENTRAL_SCHEDULER_ENABLED=false/);
  assert.doesNotMatch(wf, /vercel deploy|db:migrate:production|neon restore|npm run deploy/i);
});
