import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  requireDisposableBrowserPdf, verifyBrowserPdfSources, CURRENT_SOURCE,
  assertNoProtectedMarkers, assertDeniedResult, assertUnsignedPdf, assert2316SnapshotUnchanged,
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

test('own PDF audit allowance never hides changes to another employer or protected payroll SQL',()=>{
  const before={organizations:[{id:10}],payrollRuns:[{id:11,netPay:'10000.00'}],auditEvents:[]};
  const auditChange={...structuredClone(before),auditEvents:[{id:12,organizationId:10}]};
  assert.doesNotThrow(()=>assert2316SnapshotUnchanged(before,auditChange,10,10,'own audit'));
  assert.throws(()=>assert2316SnapshotUnchanged(before,auditChange,10,20,'foreign audit'),/foreign audit SQL changed/);
  assert.throws(()=>assert2316SnapshotUnchanged(before,auditChange,10,null,'denied audit'),/foreign audit SQL changed/);
  assert.throws(()=>assert2316SnapshotUnchanged(before,auditChange,10,true,'blanket audit'),/never a blanket boolean/);
  const payrollChange=structuredClone(auditChange);payrollChange.payrollRuns[0].netPay='10001.00';
  assert.throws(()=>assert2316SnapshotUnchanged(before,payrollChange,10,10,'own payroll'),/payroll/);
  assert.throws(()=>assert2316SnapshotUnchanged(before,before,20,20,'wrong employer'));
  assert.deepEqual(before.auditEvents,[],'Checking must not mutate the baseline');
});
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
    "assert2316SnapshotUnchanged(prior,after,actor.org.id,allowedAuditEmployerId,label)",
    "assert.equal(pdfEmployers.size,3",
    "assert.equal(ownPdf,4)",
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

test("2316 browser proof reruns for shared auth, data, test-fixture and dependency changes",()=>{
  const workflow=readFileSync(".github/workflows/tenant-2316-browser-pdf-qa.yml","utf8");
  const block=workflow.match(/^    paths:\n((?:      - "[^"\n]+"\n)+)/m);
  assert.ok(block,"PR path filters must be present and explicit");
  const watched=new Set([...block[1].matchAll(/^      - "([^"\n]+)"$/gm)].map(m=>m[1]));
  for(const dependency of [
    "src/lib/auth.ts",
    "src/lib/access.ts",
    "src/lib/permissions.ts",
    "src/lib/organization-auth-policy.ts",
    "src/lib/security-request.ts",
    "src/lib/audit.ts",
    "src/lib/critical-release-flags.ts",
    "src/lib/crypto.ts",
    "src/lib/government-id-crypto.ts",
    "src/lib/security-secret.ts",
    "src/lib/totp.ts",
    "src/db/schema.ts",
    "src/db/index.ts",
    "scripts/qa/tenant-table-http.mjs",
    "scripts/qa/apply-isolated-baseline.mjs",
    "tests/fixtures/bir-2316-certificate.ts",
    "tests/tenant-2316-legal-employer-worker.test.ts",
    "package.json",
    "package-lock.json"
]){
    assert.ok(watched.has(dependency),"Missing 2316 CI trigger for "+dependency);
  }
  for(const pattern of [
    "src/app/workspace/2316/**",
    "src/app/api/year-end/2316-certificate/**",
    "src/lib/bir-2316-*.ts",
    "src/lib/multi-entity-server.ts",
    "scripts/qa/tenant-2316-browser-pdf-*.mjs",
    "scripts/qa/tenant-2316-ssr-transfer-*.mjs",
    "tests/tenant-2316-browser-pdf-contract.test.mjs",
    ".github/workflows/tenant-2316-browser-pdf-qa.yml",
  ])assert.ok(watched.has(pattern),"Missing existing critical 2316 watch pattern: "+pattern);
});
