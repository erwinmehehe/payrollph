/**
 * PII-01: method-specific three-employer isolation for HR identifier review.
 * Disposable PostgreSQL 16 and actual production-mode localhost HTTP only.
 * Never use production identifiers, payroll payments, or provider credentials.
 *
 * The two provisional methods are GET and POST /api/employee-identifier-requests.
 * POST exercises safe rejection, not acceptance of a statutory/government ID.
 */
import assert from "node:assert/strict";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../../src/db";
import { auditEvents, employees, payrollRuns, sessions } from "../../src/db/schema";
import { essIdentifierRequests, essOtherIdentifiers } from "../../src/lib/ess-profile-schema";
import { encryptGovernmentId, governmentIdEncryptionConfigured } from "../../src/lib/government-id-crypto";

export const PII01_METHODS = Object.freeze([
  "GET employee-identifier-requests", "POST employee-identifier-requests",
]);

function requireDisposable() {
  assert.equal(process.env.CI, "true", "This PII proof is CI-only");
  assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only");
  assert.equal(new URL(process.env.SECURITY_SMOKE_URL ?? "").href, "http://127.0.0.1:3000/");
  const pg = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(pg.protocol, "postgresql:");
  assert.ok(["localhost", "127.0.0.1"].includes(pg.hostname));
  assert.equal(pg.port, "5432");
  assert.equal(pg.pathname, "/app_db");
  assert.equal(process.env.DEMO_MODE, "false");
  assert.notEqual(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "true");
  assert.notEqual(process.env.XENDIT_PAYOUTS_ENABLED, "true");
  assert.ok(!process.env.PAYMONGO_SECRET_KEY && !process.env.XENDIT_SECRET_KEY);
  assert.equal(governmentIdEncryptionConfigured(), true,
    "Synthetic identifiers must be encrypted under the disposable CI PII key");
}

function denyLeaks(response, victim, encryptedValues, label) {
  const combined = response.text + JSON.stringify([...response.headers.entries()]);
  assert.ok(!combined.includes(victim.employeeNo), label + ": victim employee number leaked");
  assert.ok(!combined.includes("VictimExclusive"), label + ": victim PII marker leaked");
  for (const sealed of encryptedValues) {
    assert.ok(!combined.includes(sealed), label + ": encrypted victim identifier leaked");
  }
}

async function victimSnapshot(victimOrgId) {
  const [requests, optional, staff, audit, runs] = await Promise.all([
    db.select().from(essIdentifierRequests)
      .where(eq(essIdentifierRequests.organizationId, victimOrgId))
      .orderBy(asc(essIdentifierRequests.id)),
    db.select().from(essOtherIdentifiers)
      .where(eq(essOtherIdentifiers.organizationId, victimOrgId))
      .orderBy(asc(essOtherIdentifiers.id)),
    db.select().from(employees)
      .where(eq(employees.organizationId, victimOrgId))
      .orderBy(asc(employees.id)),
    db.select().from(auditEvents)
      .where(eq(auditEvents.organizationId, victimOrgId))
      .orderBy(asc(auditEvents.id)),
    db.select().from(payrollRuns)
      .where(eq(payrollRuns.organizationId, victimOrgId))
      .orderBy(asc(payrollRuns.id)),
  ]);
  return { requests, optional, staff, audit, runs };
}

function reviewBody(organizationId, requestId, extra = {}) {
  return {
    organizationId, requestId, action: "reject",
    reviewNote: "Synthetic record mismatch; no official verification is claimed.",
    ...extra,
  };
}

export async function verifyPiiIdentifierReviewIsolation(f, { request, expectStatus }) {
  requireDisposable();
  const victim = f.orgs[0];
  const own = [1, 2].map((idx) => ({
    index: idx,
    org: f.orgs[idx],
    worker: f.ownedEmployees[idx - 1],
    owner: f.owners[idx],
    cookie: f.ownerSessions[idx].cookie,
    session: f.ownerSessions[idx],
  }));

  // Legitimate pending records are created before victim-only rows, ensuring
  // actual victim request IDs exceed both attackers' own IDs and the 1..6 probe.
  for (const a of own) {
    const values = await db.insert(essIdentifierRequests).values([
      {
        organizationId: a.org.id, employeeId: a.worker.id, kind: "sssNo",
        proposedEncrypted: encryptGovernmentId("12-0000000-" + a.index, { required: true }),
        requestedByUserId: a.owner.id,
      },
      {
        organizationId: a.org.id, employeeId: a.worker.id, kind: "tin",
        proposedEncrypted: encryptGovernmentId("000-000-00" + a.index + "-000", { required: true }),
        requestedByUserId: a.owner.id,
      },
    ]).returning();
    a.ownedRequest = values[0];
    a.forgedSelectorRequest = values[1];
    const persisted = await db.select().from(essIdentifierRequests)
      .where(eq(essIdentifierRequests.id, a.ownedRequest.id));
    assert.equal(persisted[0]?.organizationId, a.org.id);
  }
  const victimRows = await db.insert(essIdentifierRequests).values(
    f.victimEmployees.map((worker, idx) => ({
      organizationId: victim.id, employeeId: worker.id, kind: "sssNo",
      proposedEncrypted: encryptGovernmentId("99-0000000-" + idx, { required: true }),
      requestedByUserId: f.owners[0].id,
    })),
  ).returning();
  assert.ok(victimRows.length >= 7, "Real victim-only populated identifier requests required");
  const victimRequest = victimRows.at(-1);
  assert.ok(victimRequest.id > Math.max(6, ...own.flatMap(a =>
    [a.ownedRequest.id, a.forgedSelectorRequest.id])),
    "Actual victim ID must exceed both independently owned request IDs and six");
  const persistedVictimRequest = await db.select().from(essIdentifierRequests)
    .where(and(eq(essIdentifierRequests.id, victimRequest.id),
      eq(essIdentifierRequests.organizationId, victim.id)));
  assert.equal(persistedVictimRequest[0]?.employeeId, f.victimEmployee.id);
  const sealedValues = victimRows.map(row => row.proposedEncrypted);
  const baseline = await victimSnapshot(victim.id);

  const victimOwn = expectStatus(await request(
    "/api/employee-identifier-requests?organizationId=" + victim.id,
    { cookie: f.ownerSessions[0].cookie },
  ), 200, "Victim employer's pending real identifiers must be readable by victim owner");
  assert.ok(victimOwn.json?.requests?.some(r => r.id === victimRequest.id),
    "Victim-only row must really be accessible to its legitimate owner");

  for (const a of own) {
    // Explicitly elevate only this disposable owner session for the real
    // sensitive-action MFA gate; nothing changes any production setting.
    await db.update(sessions).set({ mfaVerifiedAt: new Date(), authMethod: "oidc" })
      .where(eq(sessions.id, a.session.id));

    const ownGet = expectStatus(await request(
      "/api/employee-identifier-requests?organizationId=" + a.org.id,
      { cookie: a.cookie },
    ), 200, "Owned PII GET must return populated pending requests");
    assert.ok(Array.isArray(ownGet.json?.requests) &&
      ownGet.json.requests.some(r => r.id === a.ownedRequest.id && r.employeeId === a.worker.id),
    "Own successful GET must contain a persisted employee identifier request");
    assert.ok(ownGet.json.requests.every(r => r.employeeId === a.worker.id &&
      r.id !== victimRequest.id), "Owner may not list victim's identifier request");
    assert.match(ownGet.headers.get("cache-control") ?? "", /^(?!.*\b(?:public|s-maxage)\b)(?=.*\bno-store\b)/i); // Next.js applies global no-store API policy.

    const foreignGet = expectStatus(await request(
      "/api/employee-identifier-requests?organizationId=" + victim.id,
      { cookie: a.cookie },
    ), 403, "Foreign employer's pending identifier list must be denied");
    denyLeaks(foreignGet, f.victimEmployee, sealedValues, "Foreign GET");

    const forgedGet = expectStatus(await request(
      "/api/employee-identifier-requests?organizationId=" + a.org.id +
        "&employeeId=" + f.victimEmployee.id,
      { cookie: a.cookie },
    ), 200, "Forged victim employee selector must not change the authenticated tenant");
    assert.ok(forgedGet.json?.requests?.some(r => r.id === a.ownedRequest.id));
    assert.ok(forgedGet.json.requests.every(r => r.employeeId === a.worker.id &&
      r.id !== victimRequest.id), "Forged victim selector must not read victim requests");
    denyLeaks(forgedGet, f.victimEmployee, sealedValues, "Forged GET");

    const ownPost = expectStatus(await request("/api/employee-identifier-requests", {
      cookie: a.cookie, method: "POST", body: reviewBody(a.org.id, a.ownedRequest.id),
    }), 200, "Owner may reject its own pending synthetic identifier request");
    assert.equal(ownPost.json?.status, "rejected");
    const [persistedOwn] = await db.select().from(essIdentifierRequests)
      .where(eq(essIdentifierRequests.id, a.ownedRequest.id));
    assert.equal(persistedOwn?.status, "rejected");
    assert.equal(persistedOwn?.reviewedByUserId, a.owner.id);

    const foreignPost = expectStatus(await request("/api/employee-identifier-requests", {
      cookie: a.cookie, method: "POST", body: reviewBody(victim.id, victimRequest.id),
    }), 403, "Foreign employer identifier review must be forbidden");
    denyLeaks(foreignPost, f.victimEmployee, sealedValues, "Foreign POST");

    const forgedPost = expectStatus(await request("/api/employee-identifier-requests", {
      cookie: a.cookie, method: "POST", body: reviewBody(a.org.id, victimRequest.id),
    }), 404, "Actual victim-only request ID cannot be decided under attacker's tenant");
    denyLeaks(forgedPost, f.victimEmployee, sealedValues, "Forged request ID POST");

    const ignoredEmployeeSelector = expectStatus(await request("/api/employee-identifier-requests", {
      cookie: a.cookie, method: "POST",
      body: reviewBody(a.org.id, a.forgedSelectorRequest.id, { employeeId: f.victimEmployee.id }),
    }), 200, "Forged victim employeeId must not replace authenticated owned request target");
    assert.equal(ignoredEmployeeSelector.json?.status, "rejected");
    const [ownSecond] = await db.select().from(essIdentifierRequests)
      .where(eq(essIdentifierRequests.id, a.forgedSelectorRequest.id));
    assert.equal(ownSecond?.employeeId, a.worker.id);
    assert.equal(ownSecond?.status, "rejected");

    assert.deepEqual(await victimSnapshot(victim.id), baseline,
      "Both attackers' own/foreign/forged GET and POST must leave victim identifiers, staff, audit and payroll unchanged");
  }
  assert.deepEqual(await victimSnapshot(victim.id), baseline,
    "The full two-attacker PII review test cannot change victim organization data");
}
