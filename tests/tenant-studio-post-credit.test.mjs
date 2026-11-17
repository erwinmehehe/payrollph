import {readWageWithdrawalFixture} from './helpers/wage-renewal-fixture.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  STUDIO_POST_PATH, STUDIO_RECEIPT, readStudioPostReceipt,
  verifyStudioPostResults,verifyStudioPostCredit,reconcileStudioPostCredit,
} from "../scripts/qa/tenant-studio-post-credit.mjs";
import {RENEWAL_FILE,readStudioDependencyRenewal,verifyRenewalResults} from "../scripts/qa/tenant-studio-dependency-renewal.mjs";
import {assertLiveTenantCounts} from "./helpers/tenant-counts.mjs";
import {verifyAllSealedWageHolds,SEALED_WAGE_HOLD_KIND} from "../scripts/qa/wage-registry-sealed-receipt-source-hold.mjs";

const manifest=()=>readWageWithdrawalFixture();
const clone=x=>structuredClone(x);
const historicReceipt=()=>{
  const m=manifest();
  assert.equal(verifyAllSealedWageHolds(m).size,5,"All source-sealed receipts must remain held");
  const r=JSON.parse(readFileSync(STUDIO_RECEIPT,"utf8"));
  assert.equal(verifyStudioPostResults(r),true,"Original eight-job/eleven-action proof remains internally sound");
  return r;
};

test("the complete historical eight-job Studio cohort cannot earn current wage-source credit",()=>{
  const r=historicReceipt(),m=manifest();
  assert.equal(Object.keys(r.actionProofs).length,11);
  assert.equal(Object.keys(r.cohort).length,8);
  assert.equal(r.cohort.scope.result.resolution.families.length,6);
  const row=m.allApiRouteFiles[STUDIO_POST_PATH].methods.find(x=>x.name==="POST");
  assert.equal(row.status,"GAP");
  assert.equal(row.testedBy,null);
  assert.equal(row.reviewedUncertified.kind,SEALED_WAGE_HOLD_KIND);
  assert.equal(row.reviewedUncertified.coverageCredits,0);
  assert.equal(row.reviewedUncertified.priorProof.recoveryCredit,"studio-post-complete");
  assert.throws(()=>verifyStudioPostCredit(m),"Old execution cannot be credited on changed wage source");
  assert.throws(()=>reconcileStudioPostCredit({write:false}),
    "Historical writer must refuse unreviewed source re-credit");
});

test("MKT-01 operator GET stays distinct from archived Studio POST",()=>{
  const m=manifest(),operator=m.allApiRouteFiles["src/app/api/marketing/leads/route.ts"].methods.find(x=>x.name==="GET");
  assert.equal(operator.status,"COVERED");
  assert.equal(operator.testedBy.operatorScoped,true);
  assert.equal(operator.testedBy.publicByDesign,false);
  const {live}=assertLiveTenantCounts(assert,m);
  const checkpoints=[...m.acceptanceStatus.matchAll(/SOLO_VERIFIED_DEV_RECOVERY Studio POST credit: ([0-9]+) COVERED \/ ([0-9]+) GAP;/g)];
  assert.ok(checkpoints.length>0,"Historic Studio evidence note cannot silently disappear");
  assert.ok(checkpoints.every(([,covered,gap])=>Number(covered)>live.coveredAfter&&Number(gap)<live.gap),
    "Previous Studio snapshot must remain historical after source-wide withdrawal");
  assert.equal(m.allApiRouteFiles[STUDIO_POST_PATH].methods.find(x=>x.name==='POST').testedBy,null);
  assert.equal(manifest().acceptanceStatus,m.acceptanceStatus);
});

test("missing historical Studio actions, modes, jobs, denials or provider flags remain rejected",()=>{
  const r=historicReceipt();
  for(const mutate of [
    x=>delete x.cohort.language,x=>delete x.cohort.sessions,
    x=>{x.cohort.sessions.result.sharedGlobalSessionPreserved=false;},
    x=>delete x.actionProofs["save-rule"],
    x=>{x.cohort.scope.job=x.cohort.draft.job;},
    x=>{x.cohort.scope.conclusion="failure";},
    x=>{x.cohort.scope.result.own=0;},
    x=>{x.cohort.scope.result.resolution.families.pop();},
    x=>{x.cohort.scope.result.unchangedVictim=false;},
    x=>{x.cohort.language.result.ownSaves=0;},
    x=>{x.providerCalls=1;},x=>{x.independentlyAccepted=true;},
  ]) {
    const changed=clone(r);mutate(changed);
    assert.throws(()=>verifyStudioPostResults(changed));
  }
});

test("all original source seals remain immutable and changed wage source cannot be re-used",()=>{
  const m=manifest();assert.equal(verifyAllSealedWageHolds(m).size,5);
  for(const target of [STUDIO_RECEIPT,
    "scripts/qa/wage-registry-sealed-receipt-source-hold-archive.json",
    "src/lib/wage-orders.ts","src/lib/statutory-rule-watch.ts"]){
    assert.throws(()=>verifyAllSealedWageHolds(m,p=>{
      const raw=readFileSync(p);
      return p===target?Buffer.concat([raw,Buffer.from(" changed")]):raw;
    }),"A modified archived input/receipt cannot pass: "+target);
  }
  assert.throws(()=>readStudioPostReceipt(),
    "Historical all-input Studio receipt must refuse the changed wage registry");
});

test("historical five-family dependency results remain complete with real positive/denial claims",()=>{
  const r=historicReceipt();
  const renewal=JSON.parse(readFileSync(RENEWAL_FILE,"utf8"));
  assert.equal(verifyRenewalResults(renewal),true);
  assert.equal(Object.keys(renewal.families).length,5);
  for(const mutate of [
    x=>delete x.families.approvals,
    x=>{x.families.approvals.jobs.pop();},
    x=>{x.families.enterprise.jobs[0].conclusion="failure";},
    x=>{x.families["spend-managed"].jobs[0].results.find(v=>v.kind==="MANAGED_CLIENT_APPROVAL_HTTP").ownApprovals=0;},
    x=>{x.families["security-writes"].jobs[0].results.find(v=>v.family==="BIO-01").trueHigherIdVictimImmutable=false;},
  ]){
    const changed=clone(renewal);mutate(changed);
    assert.throws(()=>verifyRenewalResults(changed));
  }
  assert.equal(r.independentlyAccepted,false);
  assert.throws(()=>readStudioDependencyRenewal(),"Old cross-source renewal must refuse new wage bytes");
});

test("a partial or substituted Studio POST cannot be presented as an active current proof",()=>{
  const m=manifest(),row=m.allApiRouteFiles[STUDIO_POST_PATH].methods.find(x=>x.name==="POST");
  assert.equal(row.testedBy,null);
  assert.equal(row.reviewedUncertified.kind,SEALED_WAGE_HOLD_KIND);
  for(const mutate of [
    x=>{x.status="COVERED";},
    x=>{x.testedBy=clone(x.reviewedUncertified.priorProof);},
    x=>{x.reviewedUncertified.coverageCredits=1;},
    x=>{x.reviewedUncertified.priorProof={file:RENEWAL_FILE};},
    x=>{x.reviewedUncertified.productionCertified=true;},
  ]){
    const changed=clone(m),target=changed.allApiRouteFiles[STUDIO_POST_PATH].methods.find(x=>x.name==="POST");
    mutate(target);
    assert.throws(()=>verifyAllSealedWageHolds(changed));
  }
});
