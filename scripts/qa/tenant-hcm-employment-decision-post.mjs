/**
 * Uncredited HCM decision POST candidate: two independent attacker employers,
 * real high-ID victim rows, owned successful HTTP 201 and three foreign probes.
 * Disposable PG16 and production-mode localhost HTTP only. Not release evidence.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../src/db";
import {
  auditEvents, employees, hcmEmploymentTerms, hcmEmploymentTermDecisions,
  hcmEmploymentDecisionEvents, payrollRuns,
} from "../../src/db/schema";
import {
  HCM_DECISION_POST, requireDisposableHcmDecisionEnv,
  assertVictimDecisionUnchanged, assertNoVictimDecisionLeak,
} from "./tenant-hcm-employment-decision-contract.mjs";

const EFFECTIVE_DATE = "2026-12-02";

async function tenantSnapshot(orgId) {
  const forOrg = (table) => db.select().from(table)
    .where(eq(table.organizationId, orgId)).orderBy(table.id);
  return {
    employees: await forOrg(employees),
    terms: await forOrg(hcmEmploymentTerms),
    decisions: await forOrg(hcmEmploymentTermDecisions),
    decisionEvents: await forOrg(hcmEmploymentDecisionEvents),
    auditEvents: await forOrg(auditEvents),
    payrollRuns: await forOrg(payrollRuns),
  };
}

function requestBody(orgId, employeeId, termId, reason) {
  return {
    organizationId: orgId, employeeId, employmentTermId: termId,
    decisionKind: "confirm_regular", effectiveDate: EFFECTIVE_DATE,
    nextEmploymentType: "Regular", nextTermKind: "regular",
    reason,
  };
}

export async function verifyHcmEmploymentDecisionPost(f, { request, expectStatus, makeSession }) {
  requireDisposableHcmDecisionEnv();
  const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
  const victim = f.orgs[0], attackerOrgs = [f.orgs[1], f.orgs[2]];
  assert.notEqual(attackerOrgs[0].id, attackerOrgs[1].id);

  // Dedicated fictional employees avoid modifying any source fixture relied
  // on by the other tests. Victim records are inserted LAST to give real IDs
  // greater than both attacker-owned IDs, not guessed low-number probes.
  const employeeInputs = [
    ...attackerOrgs.map((org, index) => ({
      organizationId: org.id, legalEntityId: f.entities[index + 1].id,
      orgUnitId: f.ownedUnits[index + 1].id, employeeNo: "CI-DEC-" + nonce + "-A" + index,
      firstName: "OwnDecision" + index, lastName: "Fictional",
      title: "Synthetic probation worker", avatarInitials: "QA",
      basicRate: "20000.00", startDate: "2026-01-01",
    })),
    ...Array.from({ length: 8 }, (_, index) => ({
      organizationId: victim.id, legalEntityId: f.entities[0].id,
      orgUnitId: f.ownedUnits[0].id, employeeNo: "CI-DEC-" + nonce + "-V" + index,
      firstName: "VictimDecision" + index, lastName: "Fictional",
      title: "Synthetic victim probation worker", avatarInitials: "QA",
      basicRate: "20000.00", startDate: "2026-01-01",
    })),
  ];
  const workers = await db.insert(employees).values(employeeInputs).returning();
  const terms = await db.insert(hcmEmploymentTerms).values(workers.map((worker, index) => ({
    organizationId: worker.organizationId, employeeId: worker.id,
    employmentType: "Probationary", termKind: "probationary",
    effectiveFrom: "2026-07-01", probationReviewDate: "2026-11-30",
    status: "active", reason: "Fictional PG16 tenant isolation only",
    requestedByUserId: f.owners[index < 2 ? index + 1 : 0].id,
    requestedBy: f.owners[index < 2 ? index + 1 : 0].name,
  }))).returning();
  const victimEmployee = workers.at(-1), victimTerm = terms.at(-1);
  assert.ok(victimEmployee && victimTerm && Number.isSafeInteger(victimEmployee.id)
    && Number.isSafeInteger(victimTerm.id));
  assert.ok(victimEmployee.id > Math.max(workers[0].id, workers[1].id, 6));
  assert.ok(victimTerm.id > Math.max(terms[0].id, terms[1].id, 6));
  assert.equal(victimEmployee.organizationId, victim.id);
  assert.equal(victimTerm.organizationId, victim.id);
  assert.equal(victimTerm.employeeId, victimEmployee.id);

  // A populated victim is essential. Empty-DB comparisons are not evidence.
  const victimMarker = "VICTIM-ONLY-HCM-" + nonce;
  const victimDecisions = await db.insert(hcmEmploymentTermDecisions)
    .values(terms.slice(2).map((term) => ({
      organizationId: victim.id, employeeId: term.employeeId,
      employmentTermId: term.id, decisionKind: "confirm_regular",
      effectiveDate: EFFECTIVE_DATE, status: "cancelled",
      reason: victimMarker,
      requestedByUserId: f.owners[0].id, requestedBy: f.owners[0].name,
    }))).returning();
  assert.ok(victimDecisions.at(-1).id > 6, "Real victim decision ID must exceed six");
  await db.insert(hcmEmploymentDecisionEvents).values(victimDecisions.map((decision) => ({
    organizationId: victim.id, decisionId: decision.id,
    employeeId: decision.employeeId, eventType: "requested",
    actorUserId: f.owners[0].id, actorName: f.owners[0].name,
    metadata: { marker: victimMarker },
  })));
  await db.insert(auditEvents).values({
    organizationId: victim.id, actor: f.owners[0].name,
    action: "Fictional victim HCM decision baseline",
    resource: "Synthetic HCM source", metadata: { marker: victimMarker },
  });
  const victimBefore = await tenantSnapshot(victim.id);
  assert.equal(victimBefore.decisions.length >= 8, true);
  assert.ok(victimBefore.decisionEvents.some(row => row.metadata?.marker === victimMarker));

  // Fresh MFA-authenticated owners in each attacker organization. The
  // session cookie is not reused across tenants; no impersonation shortcut.
  const privileged = await Promise.all([1, 2].map(index =>
    makeSession(f.owners[index].id, { privileged: true })));
  let positiveWrites = 0, foreignDenials = 0, forgedDenials = 0;
  const created = [];

  for (const index of [0, 1]) {
    const org = attackerOrgs[index];
    const actor = f.owners[index + 1];
    const worker = workers[index], term = terms[index];
    const cookie = privileged[index].cookie;
    const reason = "FICTIONAL-OWN-HCM-" + nonce + "-" + index;
    const beforeOwn = await tenantSnapshot(org.id);

    const owned = expectStatus(await request(HCM_DECISION_POST, {
      cookie, method: "POST", body: requestBody(org.id, worker.id, term.id, reason),
    }), 201, "Own employer must actually create a pending decision");
    const receipt = owned.json?.decision;
    assert.ok(Number.isSafeInteger(receipt?.id) && receipt.id > 0);
    assert.equal(receipt.organizationId, org.id);
    assert.equal(receipt.employeeId, worker.id);
    assert.equal(receipt.employmentTermId, term.id);
    assert.equal(receipt.decisionKind, "confirm_regular");
    assert.equal(receipt.status, "pending_approval");
    assert.equal(receipt.reason, reason);
    assert.equal(receipt.requestedByUserId, actor.id);
    assertNoVictimDecisionLeak(owned, victimMarker, "owned response");

    const afterOwn = await tenantSnapshot(org.id);
    const actual = afterOwn.decisions.find(row => row.id === receipt.id);
    assert.ok(actual, "HTTP receipt must point to the persisted SQL row");
    assert.equal(actual.organizationId, org.id);
    assert.equal(actual.employeeId, worker.id);
    assert.equal(actual.employmentTermId, term.id);
    assert.equal(actual.reason, reason);
    assert.equal(afterOwn.decisions.length, beforeOwn.decisions.length + 1);
    assert.equal(afterOwn.decisionEvents.length, beforeOwn.decisionEvents.length + 1);
    const event = afterOwn.decisionEvents.at(-1);
    assert.equal(event.organizationId, org.id);
    assert.equal(event.decisionId, receipt.id);
    assert.equal(event.employeeId, worker.id);
    assert.equal(event.eventType, "requested");
    assert.equal(event.actorUserId, actor.id);
    assert.equal(afterOwn.auditEvents.length, beforeOwn.auditEvents.length + 1);
    const audit = afterOwn.auditEvents.at(-1);
    assert.equal(audit.organizationId, org.id);
    assert.equal(audit.action, "HCM employment-term decision requested");
    assert.equal(audit.metadata?.employmentTermDecisionId, receipt.id);
    assert.equal(audit.metadata?.actorUserId, actor.id);
    assert.deepEqual(afterOwn.payrollRuns, beforeOwn.payrollRuns,
      "Decision request must never create or change a payroll run");
    assertVictimDecisionUnchanged(victimBefore, await tenantSnapshot(victim.id),
      "owned POST of employer " + org.id);
    created.push(receipt);
    positiveWrites++;

    const cases = [
      { status: 403, type: "victim-organization", body:
        requestBody(victim.id, victimEmployee.id, victimTerm.id, reason) },
      { status: 404, type: "victim-employee-and-term", body:
        requestBody(org.id, victimEmployee.id, victimTerm.id, reason) },
      { status: 404, type: "victim-term-under-own-employee", body:
        requestBody(org.id, worker.id, victimTerm.id, reason) },
      { status: 404, type: "victim-employee-under-own-term", body:
        requestBody(org.id, victimEmployee.id, term.id, reason) },
    ];
    for (const attack of cases) {
      const denied = expectStatus(await request(HCM_DECISION_POST, {
        cookie, method: "POST", body: attack.body,
      }), attack.status, "Cross-tenant " + attack.type);
      assertNoVictimDecisionLeak(denied, victimMarker, attack.type);
      assertVictimDecisionUnchanged(victimBefore, await tenantSnapshot(victim.id), attack.type);
      assert.deepEqual((await tenantSnapshot(org.id)).decisions, afterOwn.decisions,
        "Denied forged request cannot add own-org decision");
      if (attack.type === "victim-organization") foreignDenials++;
      else forgedDenials++;
    }
  }
  assert.equal(positiveWrites, 2);
  assert.equal(foreignDenials, 2);
  assert.equal(forgedDenials, 6);
  assert.notEqual(created[0].id, created[1].id);
  assert.notEqual(created[0].employeeId, created[1].employeeId);
  assertVictimDecisionUnchanged(victimBefore, await tenantSnapshot(victim.id),
    "final victim SQL isolation");

  console.log(JSON.stringify({
    kind: "HCM_EMPLOYMENT_DECISION_POST_TENANT_CANDIDATE",
    result: "PASS", ownHttp201: positiveWrites, victimOrgHttp403: foreignDenials,
    forgedVictimHttp404: forgedDenials, victimActualHighId: victimTerm.id,
    newCredits: 0, independentlyAccepted: false, productionCertified: false,
    providerTraffic: false, sourceMutation: false, payrollMutation: false,
  }));
}
