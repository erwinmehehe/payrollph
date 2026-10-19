/**
 * HIGH-RISK TENANT ISOLATION BATCH 01: 16 real GET methods, two independent
 * attacker employers and actual high-ID victim-owned records. Not 16 "safe"
 * routes until exact-head CI succeeds. Runs ONLY inside second-pass disposable
 * PostgreSQL + production-mode localhost HTTP harness.
 *
 * NO production SQL, real employees, bank transfer, posting or statutory filing.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../src/db";
import {
  auditEvents, documents, employees, legalEntities, payrollEntries,
  payrollRuns, userOrganizations, users,
} from "../../src/db/schema";

export const HIGH_RISK_BATCH_01 = Object.freeze([
  "GET payroll-runs/[id]/assurance",
  "GET payroll-runs/[id]/close",
  "GET payroll-runs/[id]/variance",
  "GET payroll-runs/[id]/release-checklist",
  "GET payroll-runs/[id]/explain/[employeeId]",
  "GET payroll-runs/[id]/exports",
  "GET compensation",
  "GET payout-profiles",
  "GET payroll-underpayments",
  "GET compliance/statutory-remittances",
  "GET compliance/filing-validations",
  "GET organizations/[id]/payroll-approvers",
  "GET exports",
  "GET reports",
  "GET self/documents",
  "GET self/payslips/[id]/explain",
]);

function hasId(rows, id, field = "id") {
  return Array.isArray(rows) && rows.some((row) => Number(row?.[field]) === id);
}
function excludesIds(rows, ids, field = "id") {
  assert.ok(Array.isArray(rows), "A real list is required, not an empty or invalid payload");
  for (const id of ids) assert.ok(!hasId(rows, id, field), "Leaked foreign record ID " + id);
}
function responseIsOwnRun(payload, f, idx) {
  assert.equal(Number(payload?.runId ?? payload?.run?.id), f.ownRuns[idx].id,
    "Owned run must be identifiable in the actual response body");
}
function responseIsOwnOrg(payload, org) {
  assert.equal(Number(payload?.organizationId), org.id,
    "Response must identify the legitimate employer");
}
function assertNoVictimBytes(response, victimMarker) {
  assert.ok(!response.text.includes(victimMarker), "Response included a real seeded victim employee marker");
  assert.ok(!response.text.startsWith("%PDF-"), "Denied request cannot return PDF bytes");
}
async function takeVictimSnapshot(victimId) {
  const [staff, runs, entries, docs, entities, audit] = await Promise.all([
    db.select().from(employees).where(eq(employees.organizationId, victimId)).orderBy(employees.id),
    db.select().from(payrollRuns).where(eq(payrollRuns.organizationId, victimId)).orderBy(payrollRuns.id),
    db.select({ id: payrollEntries.id, employeeId: payrollEntries.employeeId,
      grossPay: payrollEntries.grossPay, netPay: payrollEntries.netPay, status: payrollEntries.status,
    }).from(payrollEntries).innerJoin(payrollRuns, eq(payrollEntries.payrollRunId, payrollRuns.id))
      .where(eq(payrollRuns.organizationId, victimId)).orderBy(payrollEntries.id),
    db.select().from(documents).where(eq(documents.organizationId, victimId)).orderBy(documents.id),
    db.select().from(legalEntities).where(eq(legalEntities.organizationId, victimId)).orderBy(legalEntities.id),
    db.select().from(auditEvents).where(eq(auditEvents.organizationId, victimId)).orderBy(auditEvents.id),
  ]);
  return { staff, runs, entries, docs, entities, audit };
}

/**
 * Reference the existing smoke's request/expectStatus/makeSession helpers so
 * no test can silently drift into mocked route calls or a second DB server.
 */
export async function verifyHighRiskBatchOne(f, { request, expectStatus, makeSession }) {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only");
  assert.equal(new URL(process.env.SECURITY_SMOKE_URL).hostname, "127.0.0.1");
  assert.equal(new URL(process.env.DATABASE_URL).pathname, "/app_db");
  assert.equal(HIGH_RISK_BATCH_01.length, 16);

  const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
  const reviewerAccounts = await db.insert(users).values(f.orgs.map((org, i) => ({
    email: "highrisk-reviewer-" + i + "-" + nonce + "@example.invalid",
    name: "Fictional payroll reviewer " + i, role: "admin",
    passwordHash: "ci-only-never-used-to-login",
  }))).returning({ id: users.id });
  await db.insert(userOrganizations).values(f.orgs.map((org, i) => ({
    userId: reviewerAccounts[i].id, organizationId: org.id, role: "admin", active: true,
  })));

  const employeeAccounts = await db.insert(users).values([1, 2].map((idx) => ({
    email: "highrisk-employee-" + idx + "-" + nonce + "@example.invalid",
    name: "Fictional employee " + idx, role: "employee",
    employeeId: f.ownedEmployees[idx - 1].id,
    passwordHash: "ci-only-never-used-to-login",
  }))).returning({ id: users.id });
  await db.insert(userOrganizations).values(employeeAccounts.map((person, k) => ({
    userId: person.id, organizationId: f.orgs[k + 1].id, role: "employee", active: true,
  })));
  const ess = await Promise.all(employeeAccounts.map((account) => makeSession(account.id)));
  const victim = f.orgs[0];
  const victimEntry = (await db.select().from(payrollEntries)
    .where(and(eq(payrollEntries.payrollRunId, f.victimRun.id),
      eq(payrollEntries.employeeId, f.victimEmployee.id))).limit(1))[0];
  assert.ok(victimEntry?.id > 6 && f.victimEmployee.id > 6 && f.victimRun.id > 6,
    "Victim direct-object IDs must be real PostgreSQL records greater than six");
  const victimBefore = await takeVictimSnapshot(victim.id);
  const passed = new Set();
  const failures = [];
  const ownPositive = [0, 0];
  const deniedForeign = [0, 0];

  // Case failure is recorded, never converted into "covered"; other cases keep
  // running to expose all authorization mistakes in the same CI attempt.
  async function caseCheck(label, idx, fn) {
    try {
      await fn();
      passed.add(label + "#employer-" + idx);
      console.log("PASS batch-01 " + label + " attacker-employer-" + idx);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(label + " attacker-employer-" + idx + ": " + message);
      console.error("FAIL batch-01 " + label + " attacker-employer-" + idx + ": " + message);
    }
  }

  for (const idx of [1, 2]) {
    const ownOrg = f.orgs[idx];
    const ownerCookie = f.ownerSessions[idx].cookie;
    const employeeCookie = ess[idx - 1].cookie;
    const ownRunId = f.ownRuns[idx].id;
    const ownWorker = (await db.select().from(employees)
      .where(eq(employees.id, f.ownedEmployees[idx - 1].id)).limit(1))[0];
    assert.ok(ownWorker && ownWorker.organizationId === ownOrg.id);
    const ownEntry = (await db.select().from(payrollEntries)
      .where(and(eq(payrollEntries.payrollRunId, ownRunId),
        eq(payrollEntries.employeeId, ownWorker.id))).limit(1))[0];
    assert.ok(ownEntry && ownEntry.id > 6);

    // The broad auth fixture intentionally has ₱500 of *unclassified* pay
    // deductions. Journal export MUST fail closed on that inconsistency. Do
    // not relax the exporter or rewrite previously Released fixture rows.
    // Seed a separate, internally reconciling, synthetic current cutoff for
    // this export-only GET case: gross ₱5,000, deductions ₱0, net ₱5,000.
    // There is no disbursement, approval, agency file or real customer data.
    const [journalRun] = await db.insert(payrollRuns).values({
      organizationId: ownOrg.id, legalEntityId: f.entities[idx].id,
      periodLabel: "CI-JOURNAL-ONLY-" + nonce + "-" + idx,
      periodStart: "2026-10-16", periodEnd: "2026-10-31",
      payDate: "2026-11-01", status: "Released",
      grossPay: "5000.00", netPay: "5000.00", employeeCount: 1,
    }).returning({ id: payrollRuns.id, organizationId: payrollRuns.organizationId });
    const [journalEntry] = await db.insert(payrollEntries).values({
      payrollRunId: journalRun.id, employeeId: ownWorker.id,
      grossPay: "5000.00", deductions: "0.00", netPay: "5000.00",
    }).returning({ id: payrollEntries.id });
    assert.equal(journalRun.organizationId, ownOrg.id);
    assert.ok(journalRun.id > 6 && journalEntry.id > 6);

    const victimMarker = "VictimExclusive";

    // Each case proves 200 on a real owner-owned ID or payload BEFORE testing
    // the same route with a real victim-only ID. 401 or guessed 404 is not proof.
    const cases = [
      {
        key: "GET payroll-runs/[id]/assurance",
        own: "/api/payroll-runs/" + ownRunId + "/assurance",
        foreign: "/api/payroll-runs/" + f.victimRun.id + "/assurance",
        prove: (r) => { responseIsOwnRun(r.json, f, idx); responseIsOwnOrg(r.json, ownOrg); },
      },
      {
        key: "GET payroll-runs/[id]/close",
        own: "/api/payroll-runs/" + ownRunId + "/close",
        foreign: "/api/payroll-runs/" + f.victimRun.id + "/close",
        prove: (r) => { assert.equal(Number(r.json?.run?.id), ownRunId);
          assert.equal(Number(r.json?.run?.organizationId), ownOrg.id); },
      },
      {
        key: "GET payroll-runs/[id]/variance",
        own: "/api/payroll-runs/" + ownRunId + "/variance",
        foreign: "/api/payroll-runs/" + f.victimRun.id + "/variance",
        prove: (r) => { assert.equal(Number(r.json?.run?.id), ownRunId);
          responseIsOwnOrg(r.json, ownOrg); assert.ok(Number(r.json?.summary?.calculatedEntries) > 0); },
      },
      {
        key: "GET payroll-runs/[id]/release-checklist",
        own: "/api/payroll-runs/" + ownRunId + "/release-checklist",
        foreign: "/api/payroll-runs/" + f.victimRun.id + "/release-checklist",
        prove: (r) => { responseIsOwnRun(r.json, f, idx); responseIsOwnOrg(r.json, ownOrg);
          assert.ok(Array.isArray(r.json?.items)); },
      },
      {
        key: "GET payroll-runs/[id]/explain/[employeeId]",
        own: "/api/payroll-runs/" + ownRunId + "/explain/" + ownWorker.id,
        foreign: "/api/payroll-runs/" + f.victimRun.id + "/explain/" + f.victimEmployee.id,
        prove: (r) => { assert.equal(Number(r.json?.run?.id), ownRunId);
          assert.ok(r.json?.explanation && typeof r.json.explanation === "object"); },
      },
      {
        key: "GET payroll-runs/[id]/exports",
        own: "/api/payroll-runs/" + journalRun.id + "/exports?kind=journal",
        foreign: "/api/payroll-runs/" + f.victimRun.id + "/exports?kind=journal",
        prove: (r) => { assert.ok(r.text.length > 40 && !r.json,
          "Journal GET must return a nonempty downloadable file, not error JSON");
          assert.match(r.headers.get("content-type") ?? "", /csv|text\/plain|octet-stream/i); },
      },
      {
        key: "GET compensation",
        own: "/api/compensation?organizationId=" + ownOrg.id,
        foreign: "/api/compensation?organizationId=" + victim.id,
        prove: (r) => { assert.ok(hasId(r.json?.employees, ownWorker.id));
          excludesIds(r.json.employees, f.victimEmployees.map((e) => e.id)); },
      },
      {
        key: "GET payout-profiles",
        own: "/api/payout-profiles?organizationId=" + ownOrg.id,
        foreign: "/api/payout-profiles?organizationId=" + victim.id,
        prove: (r) => { assert.ok(Array.isArray(r.json?.profiles));
          assert.ok(r.json.profiles.some((p) => Number(p.legalEntity?.id) === f.entities[idx].id));
          assert.ok(!r.json.profiles.some((p) => Number(p.legalEntity?.id) === f.entities[0].id)); },
      },
      {
        key: "GET payroll-underpayments",
        own: "/api/payroll-underpayments?organizationId=" + ownOrg.id,
        foreign: "/api/payroll-underpayments?organizationId=" + victim.id,
        prove: (r) => { assert.ok(hasId(r.json?.employees, ownWorker.id));
          assert.ok(hasId(r.json?.releasedRuns, ownRunId));
          excludesIds(r.json.employees, f.victimEmployees.map((e) => e.id)); },
      },
      {
        key: "GET compliance/statutory-remittances",
        own: "/api/compliance/statutory-remittances?organizationId=" + ownOrg.id,
        foreign: "/api/compliance/statutory-remittances?organizationId=" + victim.id,
        prove: (r) => { responseIsOwnOrg(r.json, ownOrg);
          assert.equal(Number(r.json?.legalEntity?.id), f.entities[idx].id); },
      },
      {
        key: "GET compliance/filing-validations",
        own: "/api/compliance/filing-validations?organizationId=" + ownOrg.id,
        foreign: "/api/compliance/filing-validations?organizationId=" + victim.id,
        prove: (r) => { assert.equal(Number(r.json?.legalEntity?.id), f.entities[idx].id);
          assert.ok(Array.isArray(r.json?.forms) && r.json.forms.length > 0); },
      },
      {
        key: "GET organizations/[id]/payroll-approvers",
        own: "/api/organizations/" + ownOrg.id + "/payroll-approvers",
        foreign: "/api/organizations/" + victim.id + "/payroll-approvers",
        prove: (r) => { assert.ok(hasId(r.json?.approvers, reviewerAccounts[idx].id),
          "Second real org-local checker must be selectable");
          excludesIds(r.json.approvers, [reviewerAccounts[0].id]); },
      },
      {
        key: "GET exports",
        own: "/api/exports?organizationId=" + ownOrg.id + "&kind=employees",
        foreign: "/api/exports?organizationId=" + victim.id + "&kind=employees",
        prove: (r) => { assert.ok(r.text.includes(ownWorker.employeeNo),
          "Actual own worker number must appear in authorized exported CSV");
          assert.ok(!r.text.includes(f.victimEmployee.employeeNo || "V-DO-NOT-MATCH"));
          assert.match(r.headers.get("content-type") ?? "", /csv/i); },
      },
      {
        key: "GET reports",
        own: "/api/reports?organizationId=" + ownOrg.id + "&key=headcount",
        foreign: "/api/reports?organizationId=" + victim.id + "&key=headcount",
        prove: (r) => { responseIsOwnOrg(r.json, ownOrg);
          assert.equal(r.json?.key, "headcount");
          assert.ok(Array.isArray(r.json?.rows) && r.json.rows.length > 0,
            "Authorized report must contain seeded employer's actual headcount data"); },
      },
    ];
    assert.equal(cases.length, 14);
    for (const item of cases) {
      await caseCheck(item.key, idx, async () => {
        const owned = expectStatus(await request(item.own, { cookie: ownerCookie }), 200,
          item.key + " real own resource");
        item.prove(owned);
        ownPositive[idx - 1]++;
        const foreign = expectStatus(await request(item.foreign, { cookie: ownerCookie }), 403,
          item.key + " real victim resource");
        assertNoVictimBytes(foreign, victimMarker);
        deniedForeign[idx - 1]++;
      });
    }

    // Employee-role pair: never substitute an owner session or an anonymous 401.
    await caseCheck("GET self/documents", idx, async () => {
      const owned = expectStatus(await request("/api/self/documents", {
        cookie: employeeCookie,
      }), 200, "Employee's own documents/requirements projection");
      assert.equal(Number(owned.json?.employee?.id), ownWorker.id);
      const forged = expectStatus(await request("/api/self/documents?organizationId=" +
        victim.id + "&employeeId=" + f.victimEmployee.id, {
          cookie: employeeCookie,
        }), 200, "Forged employee selectors must still return only the signed-in employee");
      assert.equal(Number(forged.json?.employee?.id), ownWorker.id);
      assert.ok(!forged.text.includes(victimMarker), "Forged query leaked victim private employee identity");
      ownPositive[idx - 1]++;
      // Post-revocation exact 403 is below, after both employee GET positives.
    });
    await caseCheck("GET self/payslips/[id]/explain", idx, async () => {
      const own = expectStatus(await request("/api/self/payslips/" + ownEntry.id +
        "/explain", { cookie: employeeCookie }), 200, "Employee own Released pay explanation");
      assert.equal(Number(own.json?.run?.id), ownRunId);
      assert.ok(own.json?.explanation && typeof own.json.explanation === "object");
      ownPositive[idx - 1]++;
      const denied = expectStatus(await request("/api/self/payslips/" + victimEntry.id +
        "/explain", { cookie: employeeCookie }), 404, "Other employer real pay entry denied");
      assertNoVictimBytes(denied, victimMarker);
      deniedForeign[idx - 1]++;
    });

    // Revoke real employee membership while retaining the SAME session and
    // another real employer grant. Validate independent GET protections.
    const employeeUserId = employeeAccounts[idx - 1].id;
    const destinationOrg = f.orgs[idx === 1 ? 2 : 1];
    await db.insert(userOrganizations).values({
      userId: employeeUserId, organizationId: destinationOrg.id,
      role: "employee", active: true,
    });
    await db.update(userOrganizations).set({ active: false })
      .where(and(eq(userOrganizations.userId, employeeUserId),
        eq(userOrganizations.organizationId, ownOrg.id)));
    const [revoked, destination] = await Promise.all([
      db.select().from(userOrganizations).where(and(eq(userOrganizations.userId, employeeUserId),
        eq(userOrganizations.organizationId, ownOrg.id))).limit(1),
      db.select().from(userOrganizations).where(and(eq(userOrganizations.userId, employeeUserId),
        eq(userOrganizations.organizationId, destinationOrg.id))).limit(1),
    ]);
    assert.equal(revoked[0]?.active, false);
    assert.equal(destination[0]?.active, true);
    const account = expectStatus(await request("/api/account", { cookie: employeeCookie }), 200,
      "Same employee session must still exist after former employer membership removal");
    assert.equal(account.json?.profile?.id, employeeUserId);
    for (const [key, endpoint] of [
      ["GET self/documents", "/api/self/documents"],
      ["GET self/payslips/[id]/explain", "/api/self/payslips/" + ownEntry.id + "/explain"],
    ]) {
      await caseCheck(key + " former-employer revocation", idx, async () => {
        const denied = expectStatus(await request(endpoint, { cookie: employeeCookie }), 403,
          key + " must deny original employer after grant revocation");
        assertNoVictimBytes(denied, victimMarker);
        deniedForeign[idx - 1]++;
      });
    }
  }

  const victimAfter = await takeVictimSnapshot(victim.id);
  assert.deepEqual(victimAfter, victimBefore,
    "Every victim-only employee, payroll run, pay entry, document, entity and audit event must remain byte-for-byte unchanged");
  const targetProof = HIGH_RISK_BATCH_01.flatMap((method) => [method + "#employer-1", method + "#employer-2"]);
  const unmatched = targetProof.filter((id) => !passed.has(id));
  if (failures.length || unmatched.length) {
    throw new AggregateError([...failures, ...unmatched.map((id) => "No complete proof for " + id)]
      .map((msg) => new Error(msg)),
      "High-risk tenant Batch 01 NOT ACCEPTED; failed/missing proofs: " +
      [...failures, ...unmatched].join(" | "));
  }
  assert.equal(passed.size, 36,
    "16 real own/foreign method proofs plus two revoked-member controls per attacker are required");
  assert.deepEqual(ownPositive, [16, 16]);
  assert.deepEqual(deniedForeign, [17, 17]);
  console.log(JSON.stringify({
    result: "PASS", kind: "REAL_HTTP_DISPOSABLE_PG16_ONLY",
    batch: "high-risk-01", totalDistinctMethods: 16,
    successfulOwnAndForeignProofPairs: passed.size,
    independentAttackerEmployers: 2,
    validOwnPositives: ownPositive, deniedForeign: deniedForeign,
    seededVictimIdsAboveSix: [f.victimEmployee.id, f.victimRun.id, victimEntry.id],
    victimDataUnchanged: true, sensitiveActionsMovedMoney: false,
    agencySubmission: false, productionAccepted: false, broaderAuditComplete: false,
  }));
}
