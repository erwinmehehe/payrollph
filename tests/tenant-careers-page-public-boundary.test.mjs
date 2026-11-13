import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const PAGE = "src/app/careers/page.tsx";
const PROOF = "scripts/qa/tenant-careers-page-public-boundary-http.mjs";
const WORKFLOW = ".github/workflows/tenant-edg01-careers-public-get-http.yml";

function sha(path) {
  const bytes = readFileSync(path);
  return createHash("sha1").update("blob " + bytes.length)
    .update(Buffer.from([0])).update(bytes).digest("hex");
}

test("public SSR refuses coerced or duplicated employer selectors before any SQL", () => {
  const src = readFileSync(PAGE, "utf8");
  const privacy = src.indexOf("const notice = careersNoticeConfig()");
  const notice = src.indexOf("if (!notice) notFound()");
  const selector = src.indexOf('typeof raw !== "string"');
  const regex = src.indexOf('!/^[1-9][0-9]*$/.test(raw)');
  const parsed = src.indexOf("const organizationId = Number(raw)");
  const safe = src.indexOf("if (!Number.isSafeInteger(organizationId)) notFound()");
  const schema = src.indexOf("await careersSchemaReady()");
  const select = src.indexOf("await db.select(");
  const publication = src.indexOf(".where(publishedCareersPredicate(organizationId))");
  assert.ok(privacy >= 0 && notice > privacy && selector > notice &&
    regex > selector && parsed > regex && safe > parsed &&
    schema > safe && select > schema && publication > select,
    "Public Careers must reject invalid selectors and missing privacy gates before SQL");
  assert.match(src, /organizationId\?: string \| string\[\]/);
  assert.match(src, /if \(!organization\) notFound\(\);/);
  assert.match(src, /jobs=\{jobs\} privacyNoticeVersion=\{notice\.version\}/);
  assert.doesNotMatch(src, /getSessionUser|assertMembership|primaryCompanyOrganizationId/,
    "Published-only anonymous job boards must not falsely require private authentication");
  assert.doesNotMatch(src, /db\.(insert|update|delete)|from\(jobApplicants\)|salaryAmount/,
    "No private applicant or payroll data may be queried by this page");
});

test("proof uses only original fictional PG16 employers, real anonymous HTML and unchanged SQL", () => {
  const src = readFileSync(PROOF, "utf8");
  assert.ok(src.indexOf("requireDisposableCareersEnv();") <
    src.indexOf('import("../../src/db/index.ts")'),
    "Fixture must refuse nonlocal or production state before app/DB imports");
  for (const required of [
    "fixture.requireTenantTableDisposable()", "server_version_num",
    '"TTBL-ATTA-"', '"TTBL-ATTB-"', '"TTBL-VICTIM-"',
    "victimPublic.length, 1", "victimPublic[0].id > 6",
    "for (const [index, employer] of employers.entries())",
    "fixture.standaloneRequest(ownPath(employer.id))",
    "res.status, 200", "res.text.includes(victimPublic[0].title)",
    '"/careers?organizationId=" + victim.id + "&organizationId=" + victim.id',
    '"/careers?organizationId=" + employers[0].id + "&organizationId=" + victim.id',
    "denied.status, 404", "malformedDenials, invalid.length",
    '"organizations", "job_requisitions", "job_applicants"',
    '"audit_events", "payroll_runs", "employees"',
    "assert.deepEqual(await snapshot(), before",
    "pageActionCredits: 0", "independentlyAccepted: false",
    "productionCertified: false",
  ]) assert.ok(src.includes(required), "Missing public Careers tenant proof control: " + required);
  assert.doesNotMatch(src, /db\.(insert|update|delete)|pool\.query\("update /,
    "New public SSR proof must be read-only and not alter publication approvals");
});

test("Careers SSR source and proof remain explicit, unaccepted manifest GAPs", () => {
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const page = manifest.scopedPages.find(entry => entry.path === PAGE);
  assert.ok(page);
  assert.equal(manifest.scopedPages.length, 21);
  assert.equal(page.status, "GAP");
  assert.equal(page.testedBy, undefined);
  assert.equal(page.blob, sha(PAGE), "No silent page source drift without renewed review");
  assert.ok(page.reason.startsWith("Still GAP: public Careers"));
  assert.deepEqual(page.reviewedUncertified, {
    kind: "public-careers-SSR-GET-PG16-canonical-selector-unaccepted",
    originalPageBlobSha: "06cfcd7cd0d0458b4a9d8e9e61e03129396541e3",
    pageBlobSha: sha(PAGE),
    proofFile: PROOF, proofBlobSha: sha(PROOF),
    workflowFile: WORKFLOW, workflowBlobSha: sha(WORKFLOW),
    pageActionCredits: 0, methodCredits: 0,
    independentlyAccepted: false, productionCertified: false,
  });
  assert.equal(manifest.metrics.scopedPagesAndActions, 21);
});

test("dedicated careers workflow retains original publish/unpublish and proves exact-head page SSR", () => {
  const workflow = readFileSync(WORKFLOW, "utf8");
  assert.ok(workflow.includes("'src/app/careers/page.tsx'"));
  assert.ok(workflow.includes("'scripts/qa/tenant-careers-page-public-boundary-http.mjs'"));
  assert.ok(workflow.includes("'tests/tenant-careers-page-public-boundary.test.mjs'"));
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /node --test tests\/tenant-careers-page-public-boundary\.test\.mjs/);
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-careers-page-public-boundary-http\.mjs/);
  const published = workflow.indexOf("tenant-edg01-careers-publication-http.mjs --prove");
  const apiGet = workflow.indexOf("run: node --import tsx scripts/qa/tenant-edg01-careers-public-get-http.mjs");
  const newProof = workflow.indexOf("run: node --import tsx scripts/qa/tenant-careers-page-public-boundary-http.mjs");
  assert.ok(published > 0 && apiGet > published && newProof > apiGet,
    "Must preserve original publication evidence before uncredited public-page proof");
  assert.ok(workflow.includes("ref: \${{ github.event.pull_request.head.sha || github.sha }}"),
    "Proof must checkout the exact PR head, not a merge ref or unrelated SHA");
  assert.match(workflow, /npm run db:push/);
  assert.match(workflow, /127\.0\.0\.1/);
  assert.equal(sha("scripts/qa/tenant-edg01-careers-publication-http.mjs"),
    "9f799cc2344561ab8f4a47a2c0ddc162335f8096",
    "Do not modify the historical already reviewed publication method proof");
});
