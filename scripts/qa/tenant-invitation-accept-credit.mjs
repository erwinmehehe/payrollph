import {verifyXenditPostCredit,XENDIT_POST_PATH} from './tenant-xendit-post-credit.mjs';
import {verifyApprovalsCredit,APPROVALS_PATH} from './tenant-approvals-credit.mjs';
import {verifyStudioPostCredit,STUDIO_POST_PATH} from './tenant-studio-post-credit.mjs';
import {ROUTE_PATH as READINESS_GET_PATH,verifyWorkspaceReadinessCredit} from './tenant-workspace-readiness-credit.mjs';
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { assertLiveTenantCounts, baseTenantManifest } from "../../tests/helpers/tenant-counts.mjs";
import {verifyFilingPatchCredit,FILING_PATH} from "./tenant-filing-patch-credit.mjs";
import { verifyCheckoutCredit, CHECKOUT_PATH } from './tenant-billing-checkout-credit.mjs';
import { verifyYearEndCredits } from "./tenant-year-end-credit.mjs";
import { verifyWorker360LegalEmployerCredits } from "./tenant-worker360-legal-employer-credit.mjs";
import {verifiedOracleRenewalKeys} from './payroll-run-oracle-hold.mjs';
export const PINS={
  "src/app/api/invitations/accept/route.ts": "7387b8d7cd01c8fb43c155d406b4f8cbcd52f19e",
  "src/lib/tokens.ts": "a13f719b62cfb34f82f496e984987d82168bc262",
  "src/lib/auth.ts": "b13275e0e09b629ddb679c55e7898da44c72ad20",
  "src/lib/security-request.ts": "de996ebb7eb663aaebf65f8a963d955b8bc90c9d",
  "src/lib/rate-limit.ts": "05d7be3acb385e3542cf0ec3904a74796f0647b5",
  "src/lib/audit.ts": "3aa8f2c627884072c0c294dbf7861980b302927c",
  "src/db/schema.ts": "3f504163c9847a99434a5e01a72c120dfd680a02",
  "src/db/index.ts": "7a5718d0a99ce5b3a7f0f25e385f79a61be807f6",
  "scripts/qa/tenant-approval-task-contract.mjs": "aec1742a120c93e7c2f54ab127bd8312501c733a",
  "scripts/qa/tenant-invitation-preview-get-http.mjs": "4186267e9a163d9b6f49b0ce7dd6330fb19c1848",
  "scripts/qa/tenant-invitations-accept-http.mjs": "275139790f149e6b435a189f779b915d62c0af8e",
  "tests/tenant-invitation-preview-get-contract.test.mjs": "db954694b11a5421d7bb69cbfeeb1d0711e69173",
  "tests/tenant-invitations-accept-contract.test.mjs": "eb0c49c5cb641d3fcaebd888928f0e6e9e853580",
  ".github/workflows/tenant-invitation-preview-get-http.yml": "6d8e5e919ed91ca2eadc490c058405c1a1e5bf5e",
  ".github/workflows/tenant-invitations-accept-http.yml": "2349218797c58ab17d9abebe938461f0cabc817a"
};
export const RECEIPTS={
  "GET": {
    "file": "scripts/qa/tenant-invitation-preview-get-http.mjs",
    "contractFile": "tests/tenant-invitation-preview-get-contract.test.mjs",
    "workflowFile": ".github/workflows/tenant-invitation-preview-get-http.yml",
    "workflowRunId": 42569443256,
    "workflowJobId": 129003172669,
    "ownPositiveLine": 136,
    "foreignDenialLine": 147,
    "forgedSelectorLine": 130,
    "unchangedDbLine": 157,
    "victimIdOrderingLine": 98,
    "scope": "Two independent fictional bearer-token invitation previews return exact own email, role and expiry; a persisted higher-ID victim, forged selectors, six refused invalid/expired/consumed tokens, no-store/no-referrer and immutable three-employer PostgreSQL snapshots.",
    "line": 136,
    "evidence": "https://github.com/erwinmehehe/payrollph/actions/runs/42569443256/job/129003172669",
    "routeBlobSha": "7387b8d7cd01c8fb43c155d406b4f8cbcd52f19e",
    "proofBlobSha": "4186267e9a163d9b6f49b0ce7dd6330fb19c1848",
    "contractBlobSha": "db954694b11a5421d7bb69cbfeeb1d0711e69173",
    "workflowBlobSha": "6d8e5e919ed91ca2eadc490c058405c1a1e5bf5e",
    "verifiedPrHeadSha": "a58546ccfd6034b90191fd1ab72ca4ab6a45bd91",
    "runLabel": "GitHub Actions 42569443256/129003172669 PG16 invitation GET PASS",
    "label": "SOLO_VERIFIED_DEV_RECOVERY",
    "independentSecurityReview": "PENDING",
    "independentlyAccepted": false,
    "productionTested": false,
    "postgresMajor": 16
  },
  "POST": {
    "file": "scripts/qa/tenant-invitations-accept-http.mjs",
    "contractFile": "tests/tenant-invitations-accept-contract.test.mjs",
    "workflowFile": ".github/workflows/tenant-invitations-accept-http.yml",
    "workflowRunId": 42569443187,
    "workflowJobId": 129003172379,
    "ownPositiveLine": 180,
    "foreignDenialLine": 114,
    "forgedSelectorLine": 105,
    "unchangedDbLine": 118,
    "victimIdOrderingLine": 66,
    "auditRollbackLine": 167,
    "scope": "Two distinct fictional employers actually claim own invitation tokens, persist own users/employer memberships and one audit each; genuine foreign/inactive unit, forged organization/role, replay and CSRF denial; audit INSERT veto rolls back all identity grants; higher-ID victim SQL immutable.",
    "line": 180,
    "evidence": "https://github.com/erwinmehehe/payrollph/actions/runs/42569443187/job/129003172379",
    "routeBlobSha": "7387b8d7cd01c8fb43c155d406b4f8cbcd52f19e",
    "proofBlobSha": "275139790f149e6b435a189f779b915d62c0af8e",
    "contractBlobSha": "eb0c49c5cb641d3fcaebd888928f0e6e9e853580",
    "workflowBlobSha": "2349218797c58ab17d9abebe938461f0cabc817a",
    "verifiedPrHeadSha": "a58546ccfd6034b90191fd1ab72ca4ab6a45bd91",
    "runLabel": "GitHub Actions 42569443187/129003172379 PG16 invitation POST PASS",
    "label": "SOLO_VERIFIED_DEV_RECOVERY",
    "independentSecurityReview": "PENDING",
    "independentlyAccepted": false,
    "productionTested": false,
    "postgresMajor": 16
  }
};
export const ROUTE="src/app/api/invitations/accept/route.ts";
function gitBlobSha(path) {
  const bytes=readFileSync(path);
  return createHash("sha1").update(Buffer.from("blob "+bytes.length+"\0")).update(bytes).digest("hex");
}
function anchor(file,line,fragment) {
  assert.ok(Number.isInteger(line)&&line>0);
  assert.ok(readFileSync(file,"utf8").split("\n")[line-1]?.includes(fragment),
    "Source proof line drift "+file+":"+line+" "+fragment);
}
export function verifyInvitationAcceptCredits(m) {
  const target=m.allApiRouteFiles[ROUTE];
  assert.equal(target?.route,"invitations/accept");
  assert.equal(target?.gitBlobSha,PINS[ROUTE]);
  assert.deepEqual(target.methods.map(x=>x.name),["GET","POST"]);
  for(const [file,hash] of Object.entries(PINS))
    assert.equal(gitBlobSha(file),hash,"Executed PG16 source/runtime/proof drift: "+file);
  for(const verb of ["GET","POST"]) {
    const r=RECEIPTS[verb],method=target.methods.find(x=>x.name===verb);
    assert.equal(method.status,"COVERED");
    assert.equal(method.reviewedUncertified,undefined);
    assert.ok(method.reason.startsWith("Provisional distinct invitation-acceptance "+verb));
    assert.deepEqual(method.testedBy,r,"Per-method proof receipt cannot be borrowed or fabricated");
    assert.equal(r.routeBlobSha,PINS[ROUTE]);
    assert.equal(r.proofBlobSha,PINS[r.file]);
    assert.equal(r.contractBlobSha,PINS[r.contractFile]);
    assert.equal(r.workflowBlobSha,PINS[r.workflowFile]);
    assert.equal(r.verifiedPrHeadSha,"a58546ccfd6034b90191fd1ab72ca4ab6a45bd91");
    assert.equal(r.label,"SOLO_VERIFIED_DEV_RECOVERY");
    assert.equal(r.independentSecurityReview,"PENDING");
    assert.equal(r.independentlyAccepted,false);assert.equal(r.productionTested,false);
    assert.equal(r.postgresMajor,16);
    const proof=readFileSync(r.file,"utf8");
    assert.ok(proof.includes("coverageCredits: 0"),"Historic proof alone grants zero credits");
    assert.ok(proof.indexOf("requireDisposableApprovalTask();") < proof.indexOf('import("../../src/db/index.ts")'));
    if(verb==="GET") {
      anchor(r.file,r.ownPositiveLine,"const aResponse = await get(ownA.token);");
      anchor(r.file,r.foreignDenialLine,'await standaloneRequest(PATH + "?organizationId=" + victim.org.id +');
      anchor(r.file,r.forgedSelectorLine,'PATH + "?organizationId=" + victim.org.id +');
      anchor(r.file,r.unchangedDbLine,"assertReadOnly(baseline.get(employer.org.id), await snapshot(employer),");
      anchor(r.file,r.victimIdOrderingLine,"victimInvite.row.id > Math.max(ownA.row.id, ownB.row.id, 6)");
      for(const value of ["assertOwnInvitationPreview(aResponse, ownA)","assertOwnInvitationPreview(bResponse, ownB)",
          "assertInvitationPreviewDenied(response, forbidden)","allThreeEmployerStatesUnchanged: true"])
        assert.ok(proof.includes(value));
    } else {
      anchor(r.file,r.ownPositiveLine,"const response = await post(own[key].token);");
      anchor(r.file,r.foreignDenialLine,"foreign-unit invitation must be refused");
      anchor(r.file,r.forgedSelectorLine,'token, name: "Accepted Fixture " + nonce');
      anchor(r.file,r.unchangedDbLine,"assert.deepEqual(await snapshot(victim), victimBefore,");
      anchor(r.file,r.victimIdOrderingLine,"victimInvitation.row.id > Math.max(own.a.row.id, own.b.row.id, 6)");
      anchor(r.file,r.auditRollbackLine,"assert.deepEqual(await snapshot(a), beforeVeto,");
      for(const value of ["qa_invite_audit_veto","forged organizationId was ignored",
        "single-use token created exactly one account","entire higher-ID victim remains byte-identical",
        "audit-veto rollback must not issue"])assert.ok(proof.includes(value),"Lost POST proof "+value);
    }
    const workflow=readFileSync(r.workflowFile,"utf8");
    assert.ok(workflow.includes("image: postgres:16"));
    assert.ok(!workflow.includes("secrets."));
  }
  assert.notEqual(RECEIPTS.GET.workflowRunId,RECEIPTS.POST.workflowRunId);
  // Live counts follow actual verified methods, including independently merged credits.
  const { live, base } = assertLiveTenantCounts(assert, m);
  for (const verb of ["GET", "POST"])
    assert.equal(live.byKey.get(verb + " " + ROUTE)?.status, "COVERED");
  if (base) {
    const inheritedStatuses = ["GET", "POST"].map(verb =>
      base.byKey.get(verb + " " + ROUTE)?.status);
    const newlyCredited = inheritedStatuses.every(status => status === "GAP");
    const previouslyCredited = inheritedStatuses.every(status => status === "COVERED");
    assert.ok(newlyCredited || previouslyCredited,
      "Invitation proof must be an atomic GET/POST pair, never a partially inherited credit");
    const promoted = [...live.byKey].filter(([key, method]) =>
      method.status === "COVERED" && base.byKey.get(key)?.status === "GAP")
      .map(([key]) => key).sort();
    if (newlyCredited) {
      assert.deepEqual(promoted, ["GET " + ROUTE, "POST " + ROUTE].sort(),
        "Only both sealed invitation receipts may gain new credit");
    } else {
      // The one other promotion allowed on top of the merged invitation credits is the separately sealed BIR candidate POST, and
      // only with its own provisional, unaccepted receipt (its exact pins are verified by the inventory test's dedicated test).
      const birPath = "src/app/api/bir/annual-employer/candidate/route.ts";
      const birPromotions = promoted.filter(key => key === "POST " + birPath);
      if (birPromotions.length) {
        const bir = m.allApiRouteFiles[birPath].methods.find(row => row.name === "POST");
        assert.equal(bir?.testedBy?.file, "scripts/qa/tenant-bir1604c-candidate-post-http.mjs");
        assert.equal(bir.testedBy.proofPullRequest, 1891);
        assert.equal(bir.testedBy.independentSecurityReview, "PENDING");
        assert.equal(bir.testedBy.independentlyAccepted, false);
        assert.equal(bir.reviewedUncertified, undefined);
      }
      const filingPromotions = promoted.filter(key => key === "PATCH " + FILING_PATH);
      if (filingPromotions.length) {
        assert.equal(verifyFilingPatchCredit(m), 1,
          "Only the sealed filing PATCH three-leg proof can authorize its own credit");
      }
      const checkoutPromotions = promoted.filter(key => key === 'POST ' + CHECKOUT_PATH);
      if (checkoutPromotions.length) assert.equal(verifyCheckoutCredit(m), 1,
        'Only the sealed merged PG16 checkout receipt can authorize billing POST');
      const readinessPromotions=promoted.filter(k=>k==='GET '+READINESS_GET_PATH);if(readinessPromotions.length)assert.equal(verifyWorkspaceReadinessCredit(m),1);
      const approvalPromotions=promoted.filter(key=>key==='PATCH '+APPROVALS_PATH);
      if(approvalPromotions.length)assert.equal(verifyApprovalsCredit(m),1);
      const studioPromotions=promoted.filter(key=>key==='POST '+STUDIO_POST_PATH);
      if(studioPromotions.length)assert.equal(verifyStudioPostCredit(m),1);
      // The payroll exports POST: only with its own provisional, unaccepted, loopback-synthetic receipt (exact pins are verified
      // by the inventory test's dedicated test).
      const exportsPath = "src/app/api/payroll-runs/[id]/exports/route.ts";
      const renewed=verifiedOracleRenewalKeys(m);
      const payrollRenewals=promoted.filter(key=>renewed.has(key));
      const exportsPromotions = promoted.filter(key => key === "POST " + exportsPath&&!renewed.has(key));
      if (exportsPromotions.length) {
        const exportsPost = m.allApiRouteFiles[exportsPath].methods.find(row => row.name === "POST");
        assert.equal(exportsPost?.testedBy?.file, "scripts/qa/tenant-payroll-exports-post-http.mjs");
        assert.equal(exportsPost.testedBy.providerMode, "loopback-synthetic-paymongo");
        assert.equal(exportsPost.testedBy.moneyMovedByLinaw, false);
        assert.equal(exportsPost.testedBy.independentSecurityReview, "PENDING");
        assert.equal(exportsPost.testedBy.productionTested, false);
        assert.equal(exportsPost.reviewedUncertified, undefined);
      }
      // Year-end GET+POST: the renewal of the pair held by #1944, only as a pair and only with the renewed main-run receipt.
      const yearEndPath = "src/app/api/year-end/route.ts";
      const yearEndPromotions = promoted.filter(key => key === "GET " + yearEndPath || key === "POST " + yearEndPath);
      if (yearEndPromotions.length) {
        assert.equal(yearEndPromotions.length, 2, "The year-end renewal is an atomic GET/POST pair");
        assert.equal(verifyYearEndCredits(m), 2, "Only the renewed, source-matched year-end proof can authorize its credit");
      }
      // Worker 360's source-revoked GET may return to COVERED only with its
      // own passed disposable PG16 real-HTTP legal-employer GET + SSR receipts.
      // This is not an invitation credit or a transfer of its historical proof.
      const worker360Path = "src/app/api/hcm/worker-360/route.ts";
      const worker360Promotions = promoted.filter(key => key === "GET " + worker360Path);
      if (worker360Promotions.length) {
        assert.equal(worker360Promotions.length, 1);
        assert.equal(verifyWorker360LegalEmployerCredits(m), 2,
          "Worker 360 must have its separate exact-source GET and SSR legal-employer proof");
        const worker360 = m.allApiRouteFiles[worker360Path].methods.find(row => row.name === "GET");
        assert.equal(worker360.testedBy.evidenceLabel, "SOLO_VERIFIED_DEV_RECOVERY");
        assert.equal(worker360.testedBy.independentlyAccepted, false);
      }
      const oidcPromotions = promoted.filter(key => key === 'GET ' + OIDC_CALLBACK);
      if (oidcPromotions.length) assert.equal(verifyOidcCallbackCredit(m), 1);
      const xenditPromotions=promoted.filter(key=>key==='POST '+XENDIT_POST_PATH);
      if(xenditPromotions.length)assert.equal(verifyXenditPostCredit(m),1);
      assert.deepEqual(promoted, [...birPromotions, ...filingPromotions, ...checkoutPromotions,...readinessPromotions,...approvalPromotions,...studioPromotions,...exportsPromotions,...yearEndPromotions,...worker360Promotions,...oidcPromotions,...xenditPromotions,...payrollRenewals].sort(),
        "Only separately source- and proof-verified method promotions may coexist with invitation credits");
      // The base already earned these two provisional source-pinned credits.
      // Their route and complete receipt objects must be unchanged by this PR.
      const source = baseTenantManifest();
      assert.ok(source?.manifest,
        "Merged invitation credits require an inspectable exact base manifest");
      const inherited = source.manifest.allApiRouteFiles?.[ROUTE];
      assert.equal(inherited?.gitBlobSha, target.gitBlobSha,
        "Already credited invitation route source changed");
      assert.deepEqual(inherited?.methods, target.methods,
        "Already credited invitation methods must retain exact merged proof receipts");
    }
  }
  return 2;
}

import {verifyOidcCallbackCredit, OIDC_CALLBACK} from './tenant-oidc-full-credit.mjs';
