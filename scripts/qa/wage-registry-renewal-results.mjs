/** Whole-harness results, never a 2xx/setup/build success as a method proof. */
import assert from 'node:assert/strict';
import {assertAcceptedReceipt,assertRejectedReceipt} from './tenant-filing-patch-method-contract.mjs';

export const terminals={
 security:/SYNTHETIC_REAL_HTTP_ONLY/,
 dl02:/SYNTHETIC_REAL_HTTP_ONLY/,
 table:/tenant-table-proof/,
 statutory:/tenant-write-table-proof/,
 yearend:/tenant-write-table-proof/,
 approvals:/tenant-approval|APPROVAL_TYPES_COMPLETE|Money lifecycle HTTP PASS/,
 enterprise:/ENTERPRISE_ADMIN_HTTP/,
 identity:/tenant-session-identity-account/,
 bir:/bir1604c-candidate-POST-actual-HTTPS-PG16-cross-employer/,
 filing:/FILING_PATCH|filing.*(?:method|outcome)|acceptedModes/i,
 labor:/labor-inspection/,
 remittance:/statutory.*action|remittance.*(?:PASS|action)/i,
 onboarding:/onboarding-http-v1/,
 migrations:/REQUESTED_MIGRATIONS_PG16_HTTP/,
 spend:/POST and PATCH \/api\/spend|MANAGED_CLIENT_APPROVAL_HTTP/,
 triage:/triage/i,draft:/draft/i,execution:/quarantine|execution/i,
 language:/language/i,lifecycle:/automation-studio-publish-rollback-active/,scope:/recovery|scope/i,
 resolution:/resolution|resolve/i,sessions:/foreignSessionsUnchanged/,
 oracle:/ownRoleDenials/,
 payroll:/payroll-run.*(?:renewal|isolation)|ownPilotSignoffs|xenditRead/i,
 exports:/tenant-payroll-exports-post-isolation/,
 paymongo:/successes|paymongo/i,
};
const records=jobs=>jobs.flatMap(j=>j.results??[]).filter(x=>x&&typeof x==='object');
const requireRecord=(rows,predicate,message)=>{const r=rows.find(predicate);assert.ok(r,message);return r;};
const subset=(actual,expected)=>Object.entries(expected).forEach(([k,v])=>assert.deepEqual(actual[k],v,'Missing complete proof output: '+k));
export function verifyWageFamilyResults(family,jobs){
 assert.ok(terminals[family],'Unknown proof family');
 const text=JSON.stringify(jobs.flatMap(j=>[...(j.results||[]),...(j.terminalLines||[])]));
 assert.match(text,terminals[family],'Missing executed terminal evidence: '+family);
 const rows=records(jobs);
 if(family==='dl02'){
  // This existing function intentionally has no standalone console receipt.
  // Its actual call is flag-controlled inside the complete second-pass sweep;
  // require the observed execution flag AND the final full-sweep success.
  assert.equal(jobs[0].observedFlags?.TENANT_DL02_PROOF,'isolated-ci-only');
  const r=requireRecord(rows,x=>x.kind==='SYNTHETIC_REAL_HTTP_ONLY','Complete DL02-enabled sweep required');
  subset(r,{result:'PASS',attackerOrganizations:2,humanUatAccepted:false,externalProviderAccepted:false,productionApproved:false});
  assert.ok(r.assertions>=1171,'DL02 method assertions must actually finish');
 }
 for(const j of jobs){assert.ok(j.results?.length||j.terminalLines?.length||j.metadataOnly,'No executed result for '+j.jobKey);}
 if(family==='table'||family==='statutory'||family==='yearend'){
  const kinds=family==='table'?['tenant-table-proof','tenant-write-table-proof']:['tenant-write-table-proof'];
  for(const kind of kinds){const found=rows.filter(r=>r.kind===kind);assert.ok(found.length,'Missing '+kind);
   for(const r of found){assert.ok(r.rows>0);assert.equal(r.ownAndForeignPairs,r.rows*2);assert.equal(r.discriminatingProofs,r.rows);assert.equal(r.victimDatabaseUnchanged,true);assert.equal(r.productionTested,false);assert.equal(r.certified,false);}
  }
 }
 if(family==='identity')subset(requireRecord(rows,r=>r.kind==='tenant-session-identity-account','Actual identity proof required'),{fictionalEmployers:3,independentOwnerAttackers:2,higherIdVictim:true,sameEmployerPeer:true,ownNonemptySuccess:true,forgedSelectorsCannotSwitchPrincipal:true,victimAndPeerIdentityUnchanged:true,bearerTokensNeverExposed:true,providerOrPayrollWrites:false,credited:0,accepted:false});
 if(family==='filing'){
  assertAcceptedReceipt(requireRecord(rows,r=>Array.isArray(r.acceptedModes),'Both accepted-filing transports required'));
  assertRejectedReceipt(requireRecord(rows,r=>r.kind==='fictional-compliance-filing-outcome-tenant-proof','Real rejected filing required'));
  subset(requireRecord(rows,r=>r.boundedDenials===20,'Actual authenticated role/MFA guards required'),{independentEmployers:2,realHigherIdVictim:true,realEmployeeDenied:true,realManagerDenied:true,authenticatedMissingMfaDenied:true,revokedOwnerSessionStillAuthenticated:true,foreignAndAbsentIndistinguishable:true,noDeniedSqlOrAuditMutations:true,paymentProvidersCalled:false,governmentAgencyContacted:false,credits:0,independentlyAccepted:false,productionCertified:false});
 }
 if(family==='yearend'){
  const r=requireRecord(rows,r=>r.kind==='tenant-write-table-proof'&&r.family==='year-end-annualization-post','Complete year-end exports required');
  assert.equal(r.additionalActionProofs?.length,2);
  assert.deepEqual(r.additionalActionProofs.map(x=>x.attacker).sort(),[1,2]);
  for(const x of r.additionalActionProofs)subset(x,{key:'POST year-end',ownAnnualizationAndBinding:2,ownedJsonRead:1,ownedPreflightRead:2,successfulOwn2316:1,successfulOwn2316Print:1,successfulOwnAlphalistSource:1,ownExportAuditRows:3,deniedRealVictimGetAndPost:7,rejectedForgedWorkerAndRun:5,unchangedVictimDb:true,noOfficialFilingOrPayment:true,methodCredit:0,independentReviewPending:true});
 }
 if(family==='enterprise')subset(requireRecord(rows,r=>r.kind==='ENTERPRISE_ADMIN_HTTP','Actual enterprise proof required'),{attackers:2,ownTransitions:42,auditVetoRollbacks:42,foreignDenials:42,forgedDenials:22,readPairs:2,readDiscriminating:2,writeDiscriminating:42,coverageCredits:0,actualProviderTraffic:false,productionCertified:false,result:'PASS'});
 if(family==='bir')subset(requireRecord(rows,r=>r.kind==='bir1604c-candidate-POST-actual-HTTPS-PG16-cross-employer','Three BIR modes required'),{twoIndependentAttackers:true,higherIdVictim:true,persistedVictimIdAboveSix:true,allThreeModesExercised:true,unchangedAnnualAndAuditSourcesAfterDenials:true,actualProductionFiling:false,acceptedByBIR:false,externalMoneyOrAgencyCalls:0,credits:0});
 if(family==='migrations')subset(requireRecord(rows,r=>r.kind==='REQUESTED_MIGRATIONS_PG16_HTTP','Actual four-kind imports required'),{ownCommits:8,foreignDenials:8,forgedDenials:6,multipartPreviews:2,discriminationChecks:8,victimSqlAndAuditUnchanged:true,credits:0,providerCalls:0,productionCertified:false});
 if(family==='spend'){
  subset(requireRecord(rows,r=>r.target==='POST and PATCH /api/spend','Full spend actions required'),{independentAttackers:2,postActions:['category_policy','card','transaction','report'],patchDecisions:['approved','rejected'],foreignAndForgedDenied:true,actualSqlStateVerified:true,higherIdVictimImmutable:true,providerCalls:0,payouts:0,methodCredits:0,productionCertified:false});
  subset(requireRecord(rows,r=>r.kind==='MANAGED_CLIENT_APPROVAL_HTTP','Managed approval required'),{result:'PASS',attackers:2,ownApprovals:2,ownReapprovals:2,revocationRace:true,checkerSupersessionRace:true,legacyCheckerIdentityDenied:true,auditFailureRollback:true,newCoverageCredits:0,productionCertified:false});
 }
 if(family==='approvals'){
  const r=requireRecord(rows,r=>r.realHttpPostgres16===true,'Complete approval types required');
  subset(r,{ownWrites:19,victimDenials:18,forgedLinkDenials:4,auditRollbacks:18,discriminations:9,unchangedVictimSql:true,coverageCredits:0,providerCalled:false,productionCertified:false});
  for(const kind of ['tenant-approval-task-isolation','tenant-approval-sources-isolation','tenant-approval-flows-isolation'])requireRecord(rows,r=>r.kind===kind,'Missing approval family '+kind);
  assert.ok(jobs.filter(j=>j.jobKey.endsWith('money-lifecycle-pg16')).length===2,'Both payroll approval-link profiles required');
 }
 if(family==='oracle')subset(requireRecord(rows,r=>r.methods===19&&r.comparisons===76,'All nineteen run boundaries required'),{ownRoleDenials:38,revokedComparisons:38,ownRegisterPositives:3,higherIdVictim:true,unchangedVictimSql:true,providerCalls:0,coverageCredits:0,productionCertified:false});
 if(family==='onboarding')for(const r of rows.filter(r=>r.kind==='onboarding-http-v1')){assert.equal(r.victimUnchanged,true);assert.equal(r.postgresMajor,16);assert.equal(r.coverageCredits,0);assert.equal(r.productionTested,false);assert.ok(r.own>0&&r.denied>0&&r.discrimination>0);}
 return true;
}
