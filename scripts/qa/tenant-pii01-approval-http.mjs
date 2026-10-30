/**
 * Successful HR identifier approvals, not just rejection-path probes.
 * Two independently authenticated employers vs a populated high-ID victim.
 * Dedicated CI-only PG16 + production-mode localhost HTTP, no real PII.
 *
 * Separate from historical tenant-second-pass-http.mjs and its source/line
 * pinned PII-01 rejection receipts. THIS ADDS ZERO TENANT COVERAGE CREDITS.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  PII_APPROVAL_ROUTE, requireDisposablePiiApprovalEnv,
  assertNoPiiLeak, assertVictimPiiUnchanged,
} from "./tenant-pii01-approval-contract.mjs";

// Guard BEFORE importing any application module that can open a database pool.
requireDisposablePiiApprovalEnv();
const [{ db, pool }, schema, ess, crypto, orm] = await Promise.all([
  import("../../src/db/index.ts"),
  import("../../src/db/schema.ts"),
  import("../../src/lib/ess-profile-schema.ts"),
  import("../../src/lib/government-id-crypto.ts"),
  import("drizzle-orm"),
]);
const {
  auditEvents, employees, legalEntities, organizations, orgUnits,
  payrollRuns, sessions, userOrganizations, users,
} = schema;
const { essIdentifierRequests, essOtherIdentifiers } = ess;
const { encryptGovernmentId, decryptGovernmentId, governmentIdEncryptionConfigured } = crypto;
const { and, eq, asc } = orm;
const ORIGIN = "http://127.0.0.1:3000";

const SPECS = [
  { kind: "sssNo", value: (n) => "400000000" + n, target: "employee" },
  { kind: "tin", value: (n) => "40000000" + n, target: "employee" },
  { kind: "tinBranchCode", value: (n) => "00" + n, target: "employee" },
  { kind: "philHealthNo", value: (n) => "40000000000" + n, target: "employee" },
  { kind: "pagIbigNo", value: (n) => "50000000000" + n, target: "employee" },
  { kind: "passportNo", value: (n) => "FICTPAS0" + n, target: "optional-create" },
  { kind: "driversLicenseNo", value: (n) => "FICTDL00" + n, target: "optional-update" },
  { kind: "prcLicenseNo", value: (n) => "FICTPRC0" + n, target: "optional-conflict" },
  { kind: "umidNo", value: (n) => "60000000000" + n, target: "mismatch" },
];
const POSITIVE = SPECS.filter((item) => ["employee", "optional-create", "optional-update"].includes(item.target));

async function makeSession(userId) {
  requireDisposablePiiApprovalEnv();
  const token = randomBytes(32).toString("hex");
  const [row] = await db.insert(sessions).values({
    userId,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(Date.now() + 60 * 60_000),
    lastSeenAt: new Date(),
    mfaVerifiedAt: new Date(),
    authMethod: "oidc",
  }).returning({ id: sessions.id });
  assert.ok(row?.id > 0);
  return { id: row.id, cookie: "__Host-linaw_session=" + token };
}

async function post(cookie, body) {
  requireDisposablePiiApprovalEnv();
  assert.ok(cookie?.startsWith("__Host-linaw_session="));
  const response = await fetch(ORIGIN + PII_APPROVAL_ROUTE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Sec-Fetch-Site": "same-origin",
      Origin: ORIGIN,
      Cookie: cookie,
    },
    body: JSON.stringify(body),
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(45_000),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* A 500 must still fail closed. */ }
  return { status: response.status, text, json, headers: response.headers };
}

async function getPending(cookie, orgId) {
  requireDisposablePiiApprovalEnv();
  const response = await fetch(ORIGIN + PII_APPROVAL_ROUTE + "?organizationId=" + orgId, {
    headers: { Cookie: cookie, Accept: "application/json" },
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(45_000),
  });
  const text = await response.text();
  return { status: response.status, json: JSON.parse(text), text, headers: response.headers };
}

function expectStatus(response, expected, label) {
  assert.equal(response.status, expected,
    label + ": expected " + expected + ", got " + response.status +
      " " + response.text.slice(0, 120));
  return response;
}

function approveBody(orgId, requestId, value, extra = {}) {
  return {
    organizationId: orgId, requestId, action: "approve",
    verifiedAgainstRecord: true, verifiedValue: value,
    reviewNote: "Verified against fictional CI record only; no agency consulted",
    ...extra,
  };
}

async function snapshot(orgId) {
  const rows = (table) => db.select().from(table)
    .where(eq(table.organizationId, orgId)).orderBy(asc(table.id));
  const [staff, requests, optional, audit, payroll] = await Promise.all([
    rows(employees), rows(essIdentifierRequests), rows(essOtherIdentifiers),
    rows(auditEvents), rows(payrollRuns),
  ]);
  return { staff, requests, optional, audit, payroll };
}

async function seedFixture() {
  requireDisposablePiiApprovalEnv();
  assert.equal(governmentIdEncryptionConfigured(), true);
  const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
  const labels = ["Victim", "AttackerA", "AttackerB"];
  const orgs = await db.insert(organizations).values(labels.map((label) => ({
    name: "Fictional PII Approval " + label + " " + nonce,
    legalName: "Fictional PII Approval " + label + " " + nonce,
  }))).returning({ id: organizations.id });
  assert.equal(orgs.length, 3);
  assert.equal(new Set(orgs.map((org) => org.id)).size, 3);

  const owners = await db.insert(users).values(labels.map((label, index) => ({
    email: "pii-approval-" + index + "-" + nonce + "@example.invalid",
    name: "Fictional PII " + label + " " + nonce,
    passwordHash: "non-login-fixture",
    localPasswordEnabled: false,
    role: "owner",
  }))).returning({ id: users.id, name: users.name });
  await db.insert(userOrganizations).values(orgs.map((org, index) => ({
    userId: owners[index].id, organizationId: org.id,
    role: "owner", active: true,
  })));
  const entities = await db.insert(legalEntities).values(orgs.map((org, index) => ({
    organizationId: org.id, code: "PII-" + nonce + "-" + index,
    legalName: "Fictional Legal Employer " + index,
    displayName: "Fictional Legal Employer " + index,
    primaryEntity: true,
  }))).returning({ id: legalEntities.id });
  const units = await db.insert(orgUnits).values(orgs.map((org, index) => ({
    organizationId: org.id, legalEntityId: entities[index].id,
    type: "department", code: "PII-" + nonce + "-" + index,
    name: "Fictional Unit " + index,
  }))).returning({ id: orgUnits.id });

  // Insert attacker employees first, then eight victim workers. Every victim
  // ID must actually exist and exceed both owned IDs and common guessed IDs.
  const ownedEmployees = await db.insert(employees).values([1, 2].map((index) => ({
    organizationId: orgs[index].id, legalEntityId: entities[index].id,
    orgUnitId: units[index].id, employeeNo: "PII-OWN-" + nonce + "-" + index,
    firstName: "OwnIdentifier", lastName: "Fictional" + index,
    title: "Fictional HR staff", avatarInitials: "QA",
    basicRate: "18000.00", startDate: "2026-01-01",
  }))).returning();
  const victimEmployees = await db.insert(employees).values(
    Array.from({ length: 8 }, (_, index) => ({
      organizationId: orgs[0].id, legalEntityId: entities[0].id,
      orgUnitId: units[0].id, employeeNo: "PII-VICTIM-" + nonce + "-" + index,
      firstName: "VictimExclusive", lastName: "Fictional" + index,
      title: "Fictional victim", avatarInitials: "QA",
      basicRate: "19000.00", startDate: "2026-01-01",
    })),
  ).returning();
  const victimWorker = victimEmployees.at(-1);
  assert.ok(victimWorker.id > Math.max(6, ...ownedEmployees.map((row) => row.id)));

  await db.insert(payrollRuns).values(orgs.map((org, index) => ({
    organizationId: org.id, legalEntityId: entities[index].id,
    periodLabel: "PII fictional no-money " + nonce + "-" + index,
    periodStart: "2026-10-01", periodEnd: "2026-10-15",
    payDate: "2026-10-16", status: "Draft", grossPay: "0.00", netPay: "0.00",
  })));
  const victimMarker = "PII-APPROVAL-VICTIM-" + nonce;
  await db.insert(auditEvents).values({
    organizationId: orgs[0].id, actor: owners[0].name,
    action: "Fictional victim PII baseline",
    resource: victimMarker, metadata: { marker: victimMarker },
  });

  const ownersSessions = await Promise.all(owners.map((owner) => makeSession(owner.id)));
  const attackers = [1, 2].map((index) => ({
    index, org: orgs[index], owner: owners[index],
    worker: ownedEmployees[index - 1],
    cookie: ownersSessions[index].cookie, requests: {},
  }));
  for (const a of attackers) {
    const requests = await db.insert(essIdentifierRequests).values(SPECS.map((spec) => ({
      organizationId: a.org.id, employeeId: a.worker.id,
      kind: spec.kind, proposedEncrypted: encryptGovernmentId(spec.value(a.index), { required: true }),
      requestedByUserId: a.owner.id,
    }))).returning();
    a.requests = Object.fromEntries(requests.map((row) => [row.kind, row]));
    assert.equal(requests.length, SPECS.length);
    const [oldOptional] = await db.insert(essOtherIdentifiers).values({
      organizationId: a.org.id, employeeId: a.worker.id,
      kind: "driversLicenseNo",
      encryptedValue: encryptGovernmentId("PRIORLIC0" + a.index, { required: true }),
      verifiedByUserId: a.owner.id,
    }).returning();
    a.oldOptional = oldOptional;

    // Deliberately inconsistent legacy row in a DISPOSABLE database: FK
    // employee_id is valid, but its organization_id points at the victim.
    // The guard in #1606 must refuse ON CONFLICT UPDATE of this foreign row.
    const [foreignConflict] = await db.insert(essOtherIdentifiers).values({
      organizationId: orgs[0].id, employeeId: a.worker.id,
      kind: "prcLicenseNo",
      encryptedValue: encryptGovernmentId("FOREIGNPRC" + a.index, { required: true }),
      verifiedByUserId: owners[0].id,
    }).returning();
    a.foreignConflict = foreignConflict;
  }

  // A forged own-organization request with a real foreign employee FK must
  // be invisible to the employee+organization join in the approval handler.
  for (const a of attackers) {
    const [badJoin] = await db.insert(essIdentifierRequests).values({
      organizationId: a.org.id, employeeId: victimWorker.id,
      kind: a.index === 1 ? "tin" : "philHealthNo",
      proposedEncrypted: encryptGovernmentId("90000000000" + a.index, { required: true }),
      requestedByUserId: a.owner.id,
    }).returning();
    a.badJoin = badJoin;
  }

  // Seed victim requests LAST, ensuring real higher-ID victim-only IDs.
  const victimRequests = await db.insert(essIdentifierRequests).values(
    victimEmployees.map((worker, index) => ({
      organizationId: orgs[0].id, employeeId: worker.id, kind: "sssNo",
      proposedEncrypted: encryptGovernmentId("900000000" + index, { required: true }),
      requestedByUserId: owners[0].id,
    })),
  ).returning();
  assert.equal(victimRequests.length, 8);
  const victimRequest = victimRequests.at(-1);
  assert.ok(victimRequest.id > Math.max(6,
    ...attackers.flatMap((a) => Object.values(a.requests).map((row) => row.id)),
    ...attackers.map((a) => a.badJoin.id)));

  const [victimOptional] = await db.insert(essOtherIdentifiers).values({
    organizationId: orgs[0].id, employeeId: victimWorker.id,
    kind: "passportNo",
    encryptedValue: encryptGovernmentId("VICTIMPASS0", { required: true }),
    verifiedByUserId: owners[0].id,
  }).returning();
  assert.ok(victimOptional.id > 0);
  const protectedValues = [
    ...victimRequests.map((row) => row.proposedEncrypted),
    victimOptional.encryptedValue,
    ...attackers.map((a) => a.foreignConflict.encryptedValue),
    victimWorker.employeeNo,
  ];
  return {
    orgs, owners, attackers, victimRequest, victimWorker,
    victimMarker, protectedValues, victimOwnerCookie: ownersSessions[0].cookie,
  };
}

async function verify() {
  requireDisposablePiiApprovalEnv();
  const f = await seedFixture();
  const victim = f.orgs[0];
  const beforeVictim = await snapshot(victim.id);
  assert.equal(beforeVictim.requests.length, 8, "Real populated victim requests required");
  assert.ok(beforeVictim.optional.length >= 3, "Victim plus foreign-conflict rows must exist");
  assert.ok(beforeVictim.payroll.length > 0 && beforeVictim.audit.length > 0,
    "Victim payroll and audit snapshots must be nonempty");
  const victimOwn = expectStatus(
    await getPending(f.victimOwnerCookie, victim.id), 200,
    "Victim owner must read its genuine populated pending list",
  );
  assert.ok(victimOwn.json?.requests?.some((row) => row.id === f.victimRequest.id));

  let ownApproved = 0, foreignDenied = 0, forgedDenied = 0;
  let mismatchDenied = 0, staleDenied = 0, conflictDenied = 0, revokedDenied = 0;

  for (const a of f.attackers) {
    const peer = f.attackers.find((other) => other.index !== a.index);
    const peerBefore = await snapshot(peer.org.id);
    const ownPayrollBefore = (await snapshot(a.org.id)).payroll;

    for (const spec of POSITIVE) {
      const request = a.requests[spec.kind];
      const value = spec.value(a.index);
      const body = approveBody(a.org.id, request.id, value,
        spec.kind === "passportNo" ? { employeeId: f.victimWorker.id } : {});
      const prior = await snapshot(a.org.id);
      const response = expectStatus(await post(a.cookie, body), 200,
        "Own employer " + a.index + " must approve " + spec.kind);
      assert.equal(response.json?.ok, true);
      assert.equal(response.json?.status, "approved");
      assertNoPiiLeak(response, f.victimMarker, f.protectedValues, "own " + spec.kind);
      assert.ok(!response.text.includes(value), "HTTP must not echo a verified raw identifier");
      assert.ok(!response.text.includes(request.proposedEncrypted), "HTTP must not echo sealed PII");

      const current = await snapshot(a.org.id);
      const actual = current.requests.find((row) => row.id === request.id);
      assert.equal(actual?.organizationId, a.org.id);
      assert.equal(actual?.employeeId, a.worker.id);
      assert.equal(actual?.status, "approved");
      assert.equal(actual?.reviewedByUserId, a.owner.id);
      assert.ok(actual?.reviewedAt instanceof Date);
      assert.equal(current.audit.length, prior.audit.length + 1);
      const receipt = current.audit.at(-1);
      assert.equal(receipt.organizationId, a.org.id);
      assert.equal(receipt.action, "Employee identifier verified and applied");
      assert.equal(receipt.metadata?.requestId, request.id);
      assert.equal(receipt.metadata?.employeeId, a.worker.id);
      assert.equal(receipt.metadata?.kind, spec.kind);

      if (spec.target === "employee") {
        const employee = current.staff.find((row) => row.id === a.worker.id);
        assert.equal(employee?.[spec.kind], request.proposedEncrypted,
          "Authoritative employee field must be the verified own ciphertext");
        assert.equal(decryptGovernmentId(employee[spec.kind]), value);
        assert.equal(current.optional.length, prior.optional.length);
      } else {
        const optional = current.optional.find((row) => row.employeeId === a.worker.id && row.kind === spec.kind);
        assert.ok(optional, "Own optional identifier must persist in PostgreSQL");
        assert.equal(optional.organizationId, a.org.id);
        assert.equal(optional.encryptedValue, request.proposedEncrypted);
        assert.equal(optional.verifiedByUserId, a.owner.id);
        assert.equal(decryptGovernmentId(optional.encryptedValue), value);
        if (spec.target === "optional-create") {
          assert.equal(current.optional.length, prior.optional.length + 1);
        } else {
          assert.equal(optional.id, a.oldOptional.id, "Existing optional ID must update, not duplicate");
          assert.equal(current.optional.length, prior.optional.length);
        }
      }
      assert.deepEqual(current.payroll, ownPayrollBefore,
        "PII approval must not change even an owned payroll draft");
      assertVictimPiiUnchanged(beforeVictim, await snapshot(victim.id), "own " + spec.kind);
      assert.deepEqual(await snapshot(peer.org.id), peerBefore, "Own approval changed other attacker employer");
      ownApproved++;
    }

    // Every refused action must preserve own AND victim SQL/audit/payroll.
    const failingCases = [
      {
        label: "foreign organization",
        expected: 403,
        body: approveBody(victim.id, f.victimRequest.id, "9000000007"),
        count: "foreign",
      },
      {
        label: "real victim request ID with own organization selector",
        expected: 404,
        body: approveBody(a.org.id, f.victimRequest.id, "9000000007"),
        count: "forged",
      },
      {
        label: "own organization request joined to a real foreign worker",
        expected: 404,
        body: approveBody(a.org.id, a.badJoin.id, "90000000001"),
        count: "forged",
      },
      {
        label: "wrong but well-formed verified value",
        expected: 422,
        body: approveBody(a.org.id, a.requests.umidNo.id, "7000000000" + a.index + "0"),
        count: "mismatch",
      },
      {
        label: "missing explicit verification against record",
        expected: 422,
        body: approveBody(a.org.id, a.requests.umidNo.id, SPECS.at(-1).value(a.index),
          { verifiedAgainstRecord: false }),
        count: "mismatch",
      },
      {
        label: "previously approved core request replay",
        expected: 409,
        body: approveBody(a.org.id, a.requests.sssNo.id, SPECS[0].value(a.index)),
        count: "stale",
      },
      {
        label: "foreign optional-ID conflict refuses overwrite and rolls back",
        expected: 500,
        body: approveBody(a.org.id, a.requests.prcLicenseNo.id,
          SPECS.find((item) => item.kind === "prcLicenseNo").value(a.index)),
        count: "conflict",
      },
    ];
    for (const scenario of failingCases) {
      const ownBefore = await snapshot(a.org.id);
      const denied = expectStatus(await post(a.cookie, scenario.body), scenario.expected,
        "Attacker " + a.index + " " + scenario.label);
      assertNoPiiLeak(denied, f.victimMarker, f.protectedValues, scenario.label);
      assertVictimPiiUnchanged(beforeVictim, await snapshot(victim.id), scenario.label);
      assert.deepEqual(await snapshot(a.org.id), ownBefore,
        "Failed request must not change own worker, request status, audit, or payroll");
      assert.deepEqual(await snapshot(peer.org.id), peerBefore,
        "Denied request must not touch peer employer");
      if (scenario.count === "foreign") foreignDenied++;
      if (scenario.count === "forged") forgedDenied++;
      if (scenario.count === "mismatch") mismatchDenied++;
      if (scenario.count === "stale") staleDenied++;
      if (scenario.count === "conflict") conflictDenied++;
    }
    const pending = await snapshot(a.org.id);
    assert.equal(pending.requests.find((row) => row.id === a.requests.prcLicenseNo.id)?.status, "pending");
    assert.equal(pending.requests.find((row) => row.id === a.requests.umidNo.id)?.status, "pending");
    assertVictimPiiUnchanged(beforeVictim, await snapshot(victim.id), "post negative batch");

    // The same privileged session must fail after actual membership revocation.
    const memberScope = and(
      eq(userOrganizations.userId, a.owner.id),
      eq(userOrganizations.organizationId, a.org.id),
    );
    const [revoked] = await db.update(userOrganizations).set({ active: false })
      .where(memberScope).returning({ active: userOrganizations.active });
    assert.equal(revoked?.active, false);
    try {
      const before = await snapshot(a.org.id);
      const denied = expectStatus(await post(a.cookie, approveBody(
        a.org.id, a.requests.umidNo.id, SPECS.at(-1).value(a.index),
      )), 403, "Former employer access must fail for the same MFA session");
      assertNoPiiLeak(denied, f.victimMarker, f.protectedValues, "membership revoked");
      assert.deepEqual(await snapshot(a.org.id), before);
      assertVictimPiiUnchanged(beforeVictim, await snapshot(victim.id), "membership revoked");
      revokedDenied++;
    } finally {
      const [restored] = await db.update(userOrganizations).set({ active: true })
        .where(memberScope).returning({ active: userOrganizations.active });
      assert.equal(restored?.active, true);
    }
  }

  assert.equal(ownApproved, 14, "Five core + fresh/updated optional approvals per attacker");
  assert.equal(foreignDenied, 2);
  assert.equal(forgedDenied, 4);
  assert.equal(mismatchDenied, 4);
  assert.equal(staleDenied, 2);
  assert.equal(conflictDenied, 2);
  assert.equal(revokedDenied, 2);
  assertVictimPiiUnchanged(beforeVictim, await snapshot(victim.id), "final victim proof");
  console.log(JSON.stringify({
    kind: "PII01_IDENTIFIER_APPROVAL_PG16_HTTP",
    result: "PASS", ownedApprovals: ownApproved,
    foreignEmployerDenials: foreignDenied, forgedVictimDenials: forgedDenied,
    verificationDenials: mismatchDenied, staleDecisionDenials: staleDenied,
    inconsistentOptionalConflictRollbacks: conflictDenied,
    revokedMembershipDenials: revokedDenied,
    actualVictimRequestId: f.victimRequest.id,
    newCoverageCredits: 0, independentlyAccepted: false, realAgencyVerified: false,
    productionCertified: false, fictionalDbOnly: true, moneyMovement: false,
  }));
}

try {
  await verify();
} catch (error) {
  console.error("PII01_APPROVAL_PG16_HTTP_FAILED (zero credits):",
    error instanceof Error ? error.message.slice(0, 600) : "unknown error");
  process.exitCode = 1;
} finally {
  await pool.end();
}
