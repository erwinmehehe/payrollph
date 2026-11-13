import assert from "node:assert/strict";
import { verifyCreationRenewalResult } from "./payroll-run-creation-renewal-contract.mjs";

export const PAYROLL_RENEWAL_COHORTS = Object.freeze({
  "GET payroll-runs": ["secondPass"],
  "POST payroll-runs": ["creation"],
  "GET payroll-runs/[id]/assurance": ["secondPass"],
  "GET payroll-runs/[id]/close": ["secondPass"],
  "POST payroll-runs/[id]/close": ["secondPass"],
  "GET payroll-runs/[id]/connected-impact": ["readTable"],
  "GET payroll-runs/[id]/explain/[employeeId]": ["secondPass"],
  "GET payroll-runs/[id]/exports": ["secondPass"],
  "POST payroll-runs/[id]/exports": ["exportsPost"],
  "GET payroll-runs/[id]/payout-reconciliation": ["secondPass"],
  "POST payroll-runs/[id]/payout-reconciliation": ["paymongo"],
  "POST payroll-runs/[id]/pilot-signoff": ["actions"],
  "GET payroll-runs/[id]/pre-run-readiness": ["secondPass"],
  "POST payroll-runs/[id]/process": ["moneyOff", "moneyOn"],
  "GET payroll-runs/[id]/release-checklist": ["secondPass"],
  "POST payroll-runs/[id]/release": ["moneyOff", "moneyOn"],
  "POST payroll-runs/[id]/submit-review": ["moneyOff", "moneyOn"],
  "GET payroll-runs/[id]/variance": ["secondPass"],
  "GET payroll-runs/[id]/xendit-payout": ["actions"],
});
export const PAYROLL_RENEWAL_METHODS = Object.freeze(Object.keys(PAYROLL_RENEWAL_COHORTS));
const SHA = /^[a-f0-9]{40}$/;
const unique = values => new Set(values).size === values.length;
const off = (object, keys) => keys.forEach(key => assert.equal(object[key], false, key + " must not claim acceptance/real money"));

function boundary(result) {
  for (const [key, value] of Object.entries({ methods: 19, comparisons: 76, ownRoleDenials: 38,
    revokedComparisons: 38, ownRegisterPositives: 3, higherIdVictim: true, unchangedVictimSql: true,
    providerCalls: 0, coverageCredits: 0, label: "SOLO_VERIFIED_DEV_RECOVERY", productionCertified: false }))
    assert.equal(result[key], value, "Incomplete addressed-run oracle regression: " + key);
}

function secondPass(results) {
  const { summary, highRisk, closePost, readSweep } = results;
  assert.equal(summary.result, "PASS"); assert.equal(summary.kind, "SYNTHETIC_REAL_HTTP_ONLY");
  assert.equal(summary.inventoriedRoutes, 42); assert.equal(summary.probedHttpMethods, 50);
  assert.equal(summary.attackerOrganizations, 2); assert.ok(summary.assertions >= 1105);
  assert.equal(summary.victimOnlyIdsAboveSix.length, 6);
  assert.ok(summary.victimOnlyIdsAboveSix.every(id => Number.isSafeInteger(id) && id > 6));
  off(summary, ["humanUatAccepted", "externalProviderAccepted", "productionApproved"]);
  assert.equal(highRisk.kind, "REAL_HTTP_DISPOSABLE_PG16_ONLY"); assert.equal(highRisk.result, "PASS");
  assert.equal(highRisk.batch, "high-risk-01"); assert.equal(highRisk.totalDistinctMethods, 16);
  assert.equal(highRisk.successfulOwnAndForeignProofPairs, 36);
  assert.equal(highRisk.independentAttackerEmployers, 2); // Fixture identities, not human review.
  assert.deepEqual(highRisk.validOwnPositives, [16, 16]); assert.deepEqual(highRisk.deniedForeign, [17, 17]);
  assert.equal(highRisk.victimDataUnchanged, true);
  off(highRisk, ["sensitiveActionsMovedMoney", "agencySubmission", "productionAccepted", "broaderAuditComplete"]);
  assert.equal(closePost.kind, "payroll-close-post-real-http-isolation");
  assert.equal(closePost.own200, 2); assert.equal(closePost.victim404, 2); assert.equal(closePost.victimUnchanged, true);
  off(closePost, ["actualPayments", "providerCalls", "productionAccepted"]);
  assert.equal(readSweep.kind, "SYNTHETIC_PG_ONLY"); assert.equal(readSweep.protectedMethods, 6);
  assert.equal(readSweep.victimDatabaseUnchanged, true); off(readSweep, ["realEmployerAccepted", "actualMoneySent"]);
}

function readTable(result) {
  assert.equal(result.kind, "tenant-table-proof"); assert.equal(result.profile, "flagged-reads");
  assert.equal(result.pathOnly, false); assert.equal(result.rows, 6);
  assert.equal(result.ownAndForeignPairs, 12); assert.equal(result.discriminatingProofs, 6);
  assert.equal(result.victimDatabaseUnchanged, true); off(result, ["productionTested", "certified"]);
}

function exportsPost(result) {
  assert.equal(result.kind, "tenant-payroll-exports-post-isolation");
  assert.equal(result.method, "POST payroll-runs/[id]/exports");
  assert.deepEqual(result.modes, ["preflight", "disburse", "complete-manual"]);
  assert.equal(result.independentAttackers, 2); assert.equal(result.employers, 3);
  assert.equal(result.ownJourneys, 2); assert.equal(result.refusals, 80);
  for (const key of ["higherIdVictim", "syntheticProviderOnly", "victimOwnPositive", "fullSnapshotsUnchanged"])
    assert.equal(result[key], true, key);
  assert.equal(result.syntheticBatchTransfers, 2); assert.equal(result.coverageCredits, 0);
  off(result, ["realProviderContacted", "realMoneyMoved", "productionTested", "independentlyAccepted"]);
}

function actions(result) {
  assert.equal(result.kind, "tenant-payroll-run-actions-isolation");
  assert.deepEqual(result.methods, ["POST payroll-runs/[id]/pilot-signoff", "GET payroll-runs/[id]/xendit-payout"]);
  assert.equal(result.independentAttackers, 2); assert.equal(result.higherIdVictim, true);
  assert.equal(result.own.length, 4); assert.equal(result.refusals.length, 8);
  assert.equal(result.forgedSelectorsIgnored, true); assert.equal(result.victimByteIdentical, true);
  assert.equal(result.providersContacted, 0); assert.equal(result.coverageCredits, 0);
  off(result, ["moneyMoved", "productionTested", "independentlyAccepted"]);
}

function money(result, exactLinks) {
  assert.equal(result.status, "PASS"); assert.equal(result.transport, "real-http");
  assert.match(result.head, SHA); assert.equal(result.exactLinks, exactLinks);
  assert.ok(result.assertions >= 301); assert.equal(result.attackerOrganizations.length, 2);
  assert.ok(unique(result.attackerOrganizations));
  assert.ok(result.attackerOrganizations.every(id => Number.isSafeInteger(id) && id > 0));
  assert.ok(result.victimOrganizationId > Math.max(...result.attackerOrganizations));
  for (const action of ["process", "submit-review", "release"]) {
    const successes = result.successes.filter(row => row.method === "POST" && row.route === "payroll-runs/[id]/" + action);
    assert.deepEqual(successes.map(row => row.organizationId).sort((a, b) => a - b),
      [...result.attackerOrganizations].sort((a, b) => a - b));
    assert.ok(successes.every(row => row.ownSuccess === true && row.forgedSelectorExercised === true));
    const denials = result.receipts.filter(row => row.label === "foreign run " + action);
    assert.equal(denials.length, 2); assert.ok(unique(denials.map(row => row.actor)));
    assert.ok(denials.every(row => row.method === "POST" && row.status === 404 && row.unchangedVictim === true &&
      row.victimOrganizationId === result.victimOrganizationId && new RegExp("^/api/payroll-runs/[0-9]+/" + action + "$", "u").test(row.path)));
    assert.equal(new Set(denials.map(row => row.path)).size, 1, "Both attackers must address the same genuine victim");
  }
}

function paymongo(result) {
  assert.equal(result.status, "PASS"); assert.equal(result.transport, "real-http"); assert.ok(result.assertions >= 558);
  if(Object.hasOwn(result,'scope')){
    assert.equal(result.scope,'Local investigation only; all provider GET/POST intercepted; no HTTP acceptance, external calls or coverage credits');
    assert.ok(Array.isArray(result.providerCalls)&&result.providerCalls.length>0);
    for(const call of result.providerCalls){
      assert.equal(new URL(call.url).origin,'https://api.paymongo.com');
      assert.ok(['GET','POST'].includes(call.method));
    }
    // Preserve the raw artifact; do not invent booleans absent from its output.
    // The fresh source closure separately pins the guarded loopback preload.
    for(const key of ['realProviderContacted','realMoneyMoved','productionAccepted'])
      if(Object.hasOwn(result,key))assert.equal(result[key],false);
    if(Object.hasOwn(result,'syntheticProviderOnly'))assert.equal(result.syntheticProviderOnly,true);
  }else{
    assert.equal(result.syntheticProviderOnly,true);
    off(result,['realProviderContacted','realMoneyMoved','productionAccepted']);
  }
  const own = result.successes.filter(row => row.ownProviderReconcile === true);
  assert.equal(own.length, 2); assert.ok(unique(own.map(row => row.organizationId)));
  const retry = result.successes.filter(row => row.freshRetry === true);
  assert.equal(retry.length, 2); assert.ok(unique(retry.map(row => row.organizationId)));
  assert.ok(retry.every(row => row.replayBlocked && row.missingPreflightBlocked && row.stalePreflightBlocked && row.syntheticPosts === 1));
  for (const action of ["reconcile", "retry-failed"]) {
    const denied = result.receipts.filter(row => row.label === "foreign reconciliation " + action);
    assert.equal(denied.length, 2); assert.ok(unique(denied.map(row => row.actor)));
    assert.ok(denied.every(row => row.method === "POST" && row.status === 404 && row.unchangedVictim === true));
    assert.equal(new Set(denied.map(row => row.victimOrganizationId)).size, 1);
    assert.equal(new Set(denied.map(row => row.path)).size, 1);
  }
  const overlap = result.successes.filter(row => row.overlappingRetryOnce === true);
  assert.equal(overlap.length, 4);
  assert.ok(overlap.every(row => row.resendBlocked && row.finalBankReplacementBlocked && row.syntheticPosts === 1));
  assert.equal(overlap.filter(row => row.timeout === true).length, 2);
  assert.equal(result.successes.filter(row => row.mixedStatuses && row.succeededExcluded && row.pendingExcluded).length, 2);
  const malformed = result.successes.filter(row => Array.isArray(row.malformedResponseCases));
  assert.equal(malformed.length, 2);
  for (const row of malformed) {
    assert.deepEqual(row.malformedResponseCases,
      ["wrong-batch", "victim-reference", "one-cent-mismatch", "duplicate-transfer", "missing-transfer", "invalid-amount"]);
    assert.ok(row.unknownNotRetryable && row.correctedReadRecovery && row.noProviderPosts);
  }
}

/** Pure result validation. Production credit additionally requires the immutable receipt seal and all source pins. */
export function verifyPayrollRenewalResults(receipt) {
  assert.equal(receipt.schema, "payrollph-payroll-run-credit-renewal-v1");
  assert.equal(receipt.label, "SOLO_VERIFIED_DEV_RECOVERY");
  off(receipt, ["independentlyAccepted", "productionCertified", "liveActivation"]);
  assert.ok(Array.isArray(receipt.methods) && receipt.methods.length > 0 && receipt.methods.length <= 19);
  assert.ok(unique(receipt.methods));
  for (const method of receipt.methods) assert.ok(Object.hasOwn(PAYROLL_RENEWAL_COHORTS, method), "Unapproved method: " + method);
  const needed = new Set(["boundary", ...receipt.methods.flatMap(method => PAYROLL_RENEWAL_COHORTS[method])]);
  const validators = { boundary, secondPass, readTable, exportsPost, actions, paymongo,
    moneyOff: result => money(result, false), moneyOn: result => money(result, true), creation: verifyCreationRenewalResult };
  assert.ok(Object.keys(receipt.cohorts).every(key => Object.hasOwn(validators, key)));
  const jobs = new Set();
  for (const key of needed) {
    const cohort = receipt.cohorts[key]; assert.ok(cohort, "Missing actual cohort: " + key);
    assert.equal(cohort.conclusion, "success"); assert.equal(cohort.postgresMajor, 16);
    assert.equal(cohort.transport, "real-http"); assert.match(cohort.sourceHead, SHA);
    assert.ok(Number.isSafeInteger(cohort.runId) && cohort.runId > 0);
    assert.ok(Number.isSafeInteger(cohort.jobId) && cohort.jobId > 0);
    assert.ok(!jobs.has(cohort.jobId), "A borrowed job cannot impersonate a different cohort"); jobs.add(cohort.jobId);
    if (key === "creation") assert.equal(cohort.result.sourceHead, cohort.sourceHead);
    if (key === "moneyOff" || key === "moneyOn") assert.equal(cohort.result.head, cohort.sourceHead);
    validators[key](cohort.result);
  }
  return new Set(receipt.methods);
}
