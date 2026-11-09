/**
 * Single-method provisional payout-profile PATCH credit, not a blanket
 * payout/money acceptance. Historical GitHub Actions job used identical
 * route, runner, workflow and original contract blobs as current main.
 * Fresh PR-head CI and authorized maintainer acceptance are still required
 * before merging a ledger promotion.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const PAYOUT_PATCH_PATH="src/app/api/payout-profiles/route.ts";
export const PAYOUT_PATCH_EVIDENCE=Object.freeze({
  file:"scripts/qa/tenant-payout-profiles-patch-http.mjs",
  proofFile:"scripts/qa/tenant-payout-profiles-patch-http.mjs",
  line:107,
  ownPositiveLine:107,
  victimIdOrderingLine:133,
  foreignDenialLine:148,
  forgedSelectorLine:151,
  unchangedDbLine:157,
  auditRollbackLine:187,
  postgresMajor:16,
  proofPullRequest:1746,
  verifiedPrHeadSha:"7ab91ca7d3d2e62b4232b83f78d90bdff0d77173",
  workflowRunId:41633732030,
  workflowJobId:125909512360,
  evidence:"https://github.com/erwinmehehe/payrollph/actions/runs/41633732030/job/125909512360",
  routeBlobSha:"336cacb025603264af7b8c47e196aa29e8053f62",
  originalRouteBlobSha:"91d402d92ea03e66fa56951fef09187001f5f3ed",
  priorGetPrefixFnv64:"4417b941777ae2cd",
  proofBlobSha:"70c32de8fae81048c68772fba928c4adfb997987",
  contractFile:"tests/tenant-payout-profiles-patch-audit.test.mjs",
  contractBlobSha:"b1c935b940f3e30a8f3b05605184e4b1b15389e9",
  originalPassingContractBlobSha:"9f12d693c43187924c1f5b51463171720e60933a",
  workflowFile:".github/workflows/tenant-payout-profiles-patch-http.yml",
  workflowBlobSha:"a06a4210dd6aef54cb332ab72cbefafd897f2e7c",
  evidenceLabel:"SOLO_VERIFIED_DEV_RECOVERY",
  ownerReviewer:"@erwinmehehe",
  ownerIsOnlyReviewer:true,
  ownerAcceptance:"PENDING",
  independentlyAccepted:false,
  independentSecurityReview:"PENDING",
  productionTested:false,
  productionCertified:false,
});
function blobHash(text){
  const buf=Buffer.from(text,"utf8");
  return createHash("sha1").update("blob "+buf.length+"\0").update(buf).digest("hex");
}
function exactLine(lines,number,marker,label){
  assert.ok(Number.isSafeInteger(number)&&number>0&&number<=lines.length,label+" out of range");
  assert.ok(lines[number-1].includes(marker),label+" source anchor changed");
}
export function verifyPayoutProfileCredit(manifest,read=path=>readFileSync(path,"utf8")){
  const entry=manifest.allApiRouteFiles?.[PAYOUT_PATCH_PATH];
  assert.equal(entry?.route,"payout-profiles");
  assert.equal(entry.gitBlobSha,PAYOUT_PATCH_EVIDENCE.routeBlobSha);
  const matches=entry.methods.filter(m=>m.name==="PATCH");
  assert.equal(matches.length,1,"exactly one payout PATCH method allowed");
  const method=matches[0];
  assert.equal(method.status,"COVERED","payout write must have explicit provisional credit");
  assert.equal(method.reviewedUncertified,undefined,"previous zero-credit source hold must be resolved");
  assert.match(method.reason,/PROVISIONAL.*SOLO_VERIFIED_DEV_RECOVERY/);
  assert.match(method.reason,/independent.*PENDING/i);
  const receipt=method.testedBy;
  assert.ok(receipt&&typeof receipt==="object");
  for(const [key,value] of Object.entries(PAYOUT_PATCH_EVIDENCE))
    assert.deepEqual(receipt[key],value,"unreviewed payout PATCH receipt field "+key);
  const routes=Object.values(manifest.allApiRouteFiles);
  const tally=state=>routes.reduce((n,r)=>n+r.methods.filter(m=>m.status===state).length,0);
  const allCount=routes.reduce((n,r)=>n+r.methods.length,0);
  const pageGaps=manifest.scopedPages.filter(page=>page.status==="GAP").length;
    // Owner-approved cross-tenant operational credentials are a distinct status,
  // never a payout credit. Fail closed if any method outside the exact 11 is recategorized.
  const approvedTokenOnly = new Set([
    "GET jobs/cron", "GET jobs/dispatch-readiness", "GET jobs/status",
    "POST jobs/tick", "POST webhooks/drain", "GET capabilities",
    "GET readiness", "GET readiness/billing", "GET readiness/database-target",
    "GET readiness/deployment", "GET readiness/pilot-status",
  ]);
  const observedTokenOnly = Object.values(manifest.allApiRouteFiles).flatMap(route =>
    route.methods.filter(row => row.status === "PRIVILEGED-OPERATIONS-TOKEN-ONLY")
      .map(row => row.name + " " + route.route));
  // Historical main has no token-only class. The proposal must carry the exact
  // reviewed 11-method class, but must not retroactively rewrite main.
  const hasTokenOnlyClass = Object.hasOwn(manifest.metrics, "privilegedOperationsTokenOnly");
  assert.deepEqual(new Set(observedTokenOnly), hasTokenOnlyClass ? approvedTokenOnly : new Set(),
    "Unapproved token-only classification cannot bypass payout accounting");
  for (const route of Object.values(manifest.allApiRouteFiles))
    for (const row of route.methods)
      if (row.status === "PRIVILEGED-OPERATIONS-TOKEN-ONLY") {
        assert.equal(row.testedBy, null, "Token denial is not tenant method coverage");
        assert.equal(row.privilegedOperation?.methodCoverageCredits, 0);
      }
  assert.equal(allCount,tally("COVERED")+tally("PUBLIC-BY-DESIGN")+tally("GAP")+tally("PRIVILEGED-OPERATIONS-TOKEN-ONLY"),
    "No method can silently use an unrecognized classification");
  assert.equal(manifest.metrics.methods,allCount);
  assert.equal(manifest.metrics.coveredAfter,tally("COVERED"));
  assert.equal(manifest.metrics.publicByDesign,tally("PUBLIC-BY-DESIGN"));
  assert.equal(manifest.metrics.gap,tally("GAP"));
  if (hasTokenOnlyClass) assert.equal(manifest.metrics.privilegedOperationsTokenOnly,tally("PRIVILEGED-OPERATIONS-TOKEN-ONLY"));
  assert.ok(manifest.acceptanceStatus.startsWith(
    "NOT ACCEPTED: "+tally("GAP")+" API methods and "+pageGaps+" page/action GAPs"),
    "Never promote a provisional method into tenant-wide acceptance");
  const readSource=(path,sha)=>{
    const source=read(path);
    assert.equal(blobHash(source),sha,"proven source changed: "+path);
    return source;
  };
  const route=readSource(PAYOUT_PATCH_PATH,PAYOUT_PATCH_EVIDENCE.routeBlobSha);
  const script=readSource(PAYOUT_PATCH_EVIDENCE.file,PAYOUT_PATCH_EVIDENCE.proofBlobSha);
  const workflow=readSource(PAYOUT_PATCH_EVIDENCE.workflowFile,PAYOUT_PATCH_EVIDENCE.workflowBlobSha);
  readSource(PAYOUT_PATCH_EVIDENCE.contractFile,PAYOUT_PATCH_EVIDENCE.contractBlobSha);
  const patch=route.slice(route.indexOf("export async function PATCH"));
  for(const clause of [
    "requireCompanyAdmin(user.id, organizationId)",
    "eq(legalEntities.organizationId, organizationId)",
    "setWhere: eq(payoutProfiles.organizationId, organizationId)",
    "const saved = await db.transaction(async (tx) => {",
    "await recordAuditEvent({", "}, tx);",
    "PAYOUT_PROFILE_SCOPE_CONFLICT",
  ]) assert.ok(patch.includes(clause),"tenant/audit source guard missing "+clause);
  const lines=script.split("\n");
  exactLine(lines,receipt.ownPositiveLine,'const own = exact(await patch(actor, body(actor,',"owned positive");
  exactLine(lines,receipt.victimIdOrderingLine,"victimProfile.id > 6","victim ID floor");
  exactLine(lines,receipt.foreignDenialLine,"exact(await patch(actor, {","foreign tenant denial");
  exactLine(lines,receipt.forgedSelectorLine,"exact(await patch(actor, {","real victim legal entity forged");
  exactLine(lines,receipt.unchangedDbLine,"assert.deepEqual(await profileSnapshot(victim.org.id), victimBefore.profiles","unchanged victim");
  exactLine(lines,receipt.auditRollbackLine,"assert.deepEqual(await profileSnapshot(a.org.id), originalProfiles","SQL audit failure rollback");
  assert.ok(script.includes('}), 403, "True foreign employer selector is forbidden"'));
  assert.ok(script.includes('}), 404, "A real foreign legal entity forged into an own org is not found"'));
  assert.ok(script.includes('const victimOwn = exact(await patch(victim, body(victim,'));
  assert.ok(script.includes("CREATE TRIGGER ci_reject_payout_profile_audit"));
  assert.ok(script.includes("An upsert cannot adopt a foreign-tagged conflict row"));
  assert.ok(script.includes('methodCredits: 0, independentSecurityReview: "PENDING"'),
    "runner test log is deliberately not a ledger acceptance");
  assert.ok(workflow.includes("image: postgres:16") &&
    workflow.includes("node --import tsx scripts/qa/tenant-payout-profiles-patch-http.mjs") &&
    workflow.includes("npm run build") &&
    workflow.includes("127.0.0.1"));
  return 1;
}
