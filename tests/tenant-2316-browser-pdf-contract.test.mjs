import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  requireDisposableBrowserPdf, verifyBrowserPdfSources, CURRENT_SOURCE,
  assertNoProtectedMarkers, assertDeniedResult, assertUnsignedPdf,
} from "../scripts/qa/tenant-2316-browser-pdf-contract.mjs";

function syntheticEnv() {
  return {
    GITHUB_ACTIONS:"true",CI:"true",NODE_ENV:"production",
    BUILD_BLOCK_ACCEPTANCE_MODE:"synthetic-postgres-only",
    TENANT_2316_SSR_TRANSFER_PROOF:"fictional-pg16-only",
    TENANT_2316_BROWSER_PDF_PROOF:"fictional-pg16-only",
    DATABASE_URL:"postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    APP_BASE_URL:"http://127.0.0.1:3000",
    TRUSTED_APP_ORIGINS:"http://127.0.0.1:3000",
    SECURITY_SMOKE_URL:"http://127.0.0.1:3000",
    DEMO_MODE:"false",REQUIRE_PRIVILEGED_MFA:"true",
    BIR_2316_CERTIFICATE_DRAFT_ENABLED:"true",
    BIR_2316_RECONCILIATION_ENABLED:"true",
    BIR_2316_WITHHOLDING_EVIDENCE_ENABLED:"true",
    YEAR_END_PRIOR_EVIDENCE_ENABLED:"true",
    MULTI_ENTITY_ENABLED:"true",
    WORKER_ENABLED:"false",CENTRAL_SCHEDULER_ENABLED:"false",
    PAYMONGO_DISBURSEMENTS_ENABLED:"false",
    XENDIT_PAYOUTS_ENABLED:"false",XENDIT_BILLING_ENABLED:"false",
    NEXT_TELEMETRY_DISABLED:"1",
  };
}
test("only a dedicated, provider-off disposable PostgreSQL 16 job may run",()=>{
  const base=syntheticEnv();
  assert.equal(requireDisposableBrowserPdf(base),true);
  for(const [key,value] of [
    ["GITHUB_ACTIONS","false"],["CI","false"],["NODE_ENV","development"],
    ["TENANT_2316_BROWSER_PDF_PROOF",""],
    ["DATABASE_URL","postgresql://superuser@production.example/app_db"],
    ["SECURITY_SMOKE_URL","https://payroll.example"],
    ["PAYMONGO_DISBURSEMENTS_ENABLED","true"],
    ["XENDIT_PAYOUTS_ENABLED","true"],
    ["WORKER_ENABLED","true"],["REQUIRE_PRIVILEGED_MFA","false"],
    ["MULTI_ENTITY_ENABLED","false"],["NEXT_TELEMETRY_DISABLED","0"],
    ["OPENAI_API_KEY","not-a-real-key"],["NEON_DATABASE_URL","not-a-real-url"],
  ])assert.throws(()=>requireDisposableBrowserPdf({...base,[key]:value}),
    /TENANT_2316_REFUSED|2316 browser\/PDF runner/,
    "Unsafe "+key+" must fail before application/DB imports");
});
test("every form, withholding, API and PDF dependency is source-pinned; page stays GAP",()=>{
  assert.equal(verifyBrowserPdfSources(),true);
  assert.equal(Object.keys(CURRENT_SOURCE).length,8);
  const m=JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json","utf8"));
  const page=m.scopedPages.find(x=>x.path==="src/app/workspace/2316/page.tsx");
  assert.equal(page.status,"GAP");assert.equal(page.reviewedUncertified.pageActionCredits,0);
  assert.equal(page.testedBy,undefined);
  assert.match(m.acceptanceStatus,/^NOT ACCEPTED/);
});
test("negative assertions reject fake 200, leaked data, or a forged PDF",async()=>{
  const secrets=[{org:{name:"PRIVATE-ORG"},worker:{employeeNo:"PRIVATE-EMP"},
    entity:{legalName:"PRIVATE-ENTITY"},marker:"PRIVATE-SOURCE"}];
  for(const status of [200,201,302,400,401,409,500])assert.throws(()=>
    assertDeniedResult({status,text:"Not Found"},secrets,"false negative"));
  for(const marker of [
    "PRIVATE-ORG","PRIVATE-EMP","PRIVATE-ENTITY","PRIVATE-SOURCE",
    "\\u0050RIVATE-SOURCE",
  ])assert.throws(()=>assertNoProtectedMarkers(
    "Denied "+marker,secrets,"fake missing marker"));
  assert.throws(()=>assertDeniedResult({
    status:404,text:"Prepare an unsigned Form 2316",
  },secrets,"fake 404"),/private 2316 shell/);
  assert.throws(()=>assertDeniedResult({
    status:404,text:"data-organization-id=123",
  },secrets,"fake 404"),/private 2316 shell/);
  await assert.rejects(()=>assertUnsignedPdf(Buffer.from("not a pdf"),"Example"));
});
test("actual Playwright, PostgreSQL, digest-revocation, and PDF paths may not be replaced with a static stub",()=>{
  const runner=readFileSync("scripts/qa/tenant-2316-browser-pdf-http.mjs","utf8");
  const workflow=readFileSync(".github/workflows/tenant-2316-browser-pdf-qa.yml","utf8");
  const minimum=[
    "requireDisposableBrowserPdf();",
    "verifyBrowserPdfSources();",
    'import("playwright")',
    'import("../../src/db/index.ts")',
    'fixture.seedEmployer("ATTA"',
    'fixture.seedEmployer("ATTB"',
    'fixture.seedEmployer("VICTIM"',
    'await login(context,actor,generateTotp)',
    'await load2316CertificateSource({',
    'await page.goto(pageUrl(a)',
    'await sourceButton.click()',
    'await downloadWait',
    'await assertUnsignedPdf(downloadedBytes',
    'assert.equal(staleResponse.json?.code,"CERTIFICATE_SOURCE_CHANGED")',
    'await db.delete(s.userLegalEntityGrants)',
    'await db.update(s.userOrganizations).set({active:false})',
    "assert.deepEqual(after,prior",
    'TENANT_2316_BROWSER_PDF_COMPLETE',
    "pageCredits:0,apiMethodCredits:0",
  ];
  for(const marker of minimum)assert.ok(runner.includes(marker),
    "Executable proof missing: "+marker);
  for(const marker of [
    "image: postgres:16",
    "npm run db:push",
    "node scripts/qa/apply-isolated-baseline.mjs",
    "playwright@1.55.0",
    "playwright install --only-shell chromium",
    "scripts/qa/tenant-2316-browser-pdf-http.mjs",
    "ref: "+String.fromCharCode(36)+"{{ github.event.pull_request.head.sha || github.sha }}",
    'BIR_2316_CERTIFICATE_DRAFT_ENABLED: "true"',
    'PAYMONGO_DISBURSEMENTS_ENABLED: "false"',
    'REQUIRE_PRIVILEGED_MFA: "true"',
  ])assert.ok(workflow.includes(marker),"Real CI job missing "+marker);
  assert.match(workflow,/node-version: "22"/);
  assert.doesNotMatch(workflow,/PAYMONGO_DISBURSEMENTS_ENABLED: "true"/);
});
