/** Dependency-free mirror of the existing complete Studio result contract.
 * Every constant and assertion must remain byte-identical to the original.
 * Historical YAML/receipt writers are deliberately not imported by source-only jobs. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const ACTIONS=Object.freeze({
 'quarantine-execution-step':'execution','triage-operational-case':['triage','resolution','scope'],
 'retry-execution-step':['scope','sessions'],'replay-execution':['scope','sessions'],
 'draft-from-language':'language','save-language-draft':'language',
 'create-from-template':'draft','save-rule':'draft','publish-rule':'lifecycle',
 'rollback-rule':'lifecycle','set-active':'lifecycle',
});
export function verifyStudioPostResults(r){
 assert.equal(r.label,'SOLO_VERIFIED_DEV_RECOVERY');assert.equal(r.postgresMajor,16);
 assert.equal(r.providerCalls,0);assert.equal(r.productionAccepted,false);assert.equal(r.independentlyAccepted,false);
 assert.deepEqual(r.actionProofs,ACTIONS);assert.deepEqual(Object.keys(r.cohort).sort(),['triage','draft','lifecycle','execution','resolution','language','scope','sessions'].sort());
 assert.equal(new Set(Object.values(r.cohort).map(j=>j.job)).size,8,'Eight distinct executed proof jobs required');
 for(const j of Object.values(r.cohort)){assert.equal(j.conclusion,'success');assert.ok(Number.isSafeInteger(j.job)&&j.job>0);assert.ok(Number.isSafeInteger(j.run)&&j.run>0);assert.match(j.head,/^[a-f0-9]{40}$/);}
 const data=k=>r.cohort[k].result;
 const sessions=data('sessions');
 for(const key of ['fictionalPG16','twoForeignEmployers','higherIdVictim','ownRetry','ownReplay','foreignSessionsUnchanged','sharedAccountFailClosed','employerMembershipDeactivation','sharedGlobalSessionPreserved'])assert.equal(sessions[key],true,key);
 assert.equal(sessions.providerCalls,0);assert.equal(sessions.moneyMoved,false);assert.equal(sessions.newMethodCredits,0);assert.equal(sessions.productionAccepted,false);
 const t=data('triage');assert.deepEqual([t.ownSuccess,t.foreignDenials,t.negativeChecks],[2,4,18]);assert.equal(t.higherIdVictim,true);assert.equal(t.readOnlyAuthoritativeSources,true);
 const d=data('draft');assert.deepEqual([d.ownCreates,d.ownUpdates,d.foreignDenials,d.otherDenials],[5,2,8,10]);assert.equal(d.victimSQLUnchangedByAttackers,true);assert.equal(d.automationExecutions,0);
 const l=data('lifecycle');assert.deepEqual([l.ownedPublications,l.ownedActivations,l.ownedDisables,l.ownedRollbacks,l.foreignDenials,l.otherDenials],[2,2,2,2,22,19]);assert.equal(l.allTenantSqlProtected,true);assert.equal(l.noExternalProviders,true);
 const e=data('execution');assert.deepEqual([e.ownQuarantines,e.ownAcknowledgements,e.ownRetries,e.ownResolves,e.ownReopens,e.ownReplays,e.foreignDenials,e.otherDenials],[2,2,2,2,2,2,24,20]);assert.equal(e.foreignAndOwnSqlBound,true);assert.equal(e.noExternalProviderCalls,true);
 const resolution=data('resolution');assert.deepEqual([resolution.ownSuccess,resolution.foreignDenials,resolution.negativeChecks,resolution.auditRollbacks],[4,12,56,4]);assert.equal(resolution.victimBusinessIdsOverSix,true);
 const language=data('language');assert.deepEqual([language.ownProposals,language.ownSaves,language.denials,language.discriminations],[3,3,44,12]);assert.equal(language.providerCalls,0);assert.equal(language.persistedOwnDrafts,true);
 const scope=data('scope');assert.deepEqual([scope.own,scope.denials,scope.discriminations,scope.locks],[16,64,16,1]);assert.equal(scope.realWorkerSessionEffects,true);assert.equal(scope.unchangedVictim,true);
 assert.equal(scope.twoAttackers,true);assert.equal(scope.higherIdVictim,true);assert.equal(scope.providerCalls,0);
 assert.equal(language.twoAttackers,true);assert.equal(language.higherIdVictim,true);
 assert.equal(t.twoIndependentOwners,true);assert.equal(d.victimRuleAndVersionIdsOverSix,true);
 assert.equal(l.independentAuthenticatedOwners,2);assert.equal(l.realVictimRuleAndVersionIdsAboveSix,true);
 assert.equal(e.twoIndependentAuthenticatedOwners,true);assert.equal(e.higherIdVictimOperationalResources,true);
 for(const j of Object.values(r.cohort))for(const flag of ['productionAccepted','independentlyAccepted','productionCertified','productionTested'])if(Object.hasOwn(j.result,flag))assert.equal(j.result[flag],false,flag);
 assert.deepEqual(scope.resolution?.families,['coverage_recovery','timesheet_escalation','missing_timesheet_escalation','attendance_resolution','payroll_readiness','statutory_followup']);
 assert.deepEqual([scope.resolution.own,scope.resolution.denials,scope.resolution.discriminations],[36,36,36]);assert.equal(scope.resolution.authoritativeSourcesUnchanged,true);
 return true;
}

const original=readFileSync('scripts/qa/tenant-studio-post-credit.mjs','utf8').replaceAll('\r\n','\n');
const own=readFileSync(new URL(import.meta.url),'utf8').replaceAll('\r\n','\n');
const declaration='const '+'ACTIONS=Object.freeze',start='export function '+'verifyStudioPostResults',end='export function '+'readStudioPostReceipt';
assert.equal(own.slice(own.indexOf(declaration),own.indexOf(start)),original.slice(original.indexOf(declaration),original.indexOf(start)),'Studio action requirements changed');
assert.equal(own.slice(own.indexOf(start),own.indexOf('\nconst original=')).trim(),original.slice(original.indexOf(start),original.indexOf(end)).trim(),'Studio result assertions changed');
