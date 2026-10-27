/**
 * Employee Self-Service statutory/identity tenant boundary: actual HTTP/PG16.
 * Two independent fictional attacker employers, populated owned controls,
 * forged employer/employee selectors and a retained session after revocation.
 * This runs only inside the existing isolated tenant-second-pass harness.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../src/db";
import {
  auditEvents, complianceActionTasks, outbox, statutoryContributionIssueCases,
  statutoryContributionIssueEvents, statutoryRemittanceBatches, statutoryRemittanceMembers,
  userOrganizations, users,
} from "../../src/db/schema";
import { essIdentifierRequests } from "../../src/lib/ess-profile-schema";

export const ESS_METHODS = Object.freeze([
  "GET self/identifiers", "POST self/identifiers",
  "GET self/contribution-issues", "POST self/contribution-issues",
]);

function requireDisposable() {
  const app = new URL(process.env.SECURITY_SMOKE_URL ?? "");
  const pg = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only");
  assert.equal(app.href, "http://127.0.0.1:3000/");
  assert.equal(pg.protocol, "postgresql:");
  assert.equal(pg.hostname, "127.0.0.1");
  assert.equal(pg.port, "5432");
  assert.equal(pg.pathname, "/app_db");
  assert.ok(process.env.PII_ENCRYPTION_KEY, "isolated identity encryption key required");
  assert.notEqual(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "true");
  assert.notEqual(process.env.XENDIT_PAYOUTS_ENABLED, "true");
  assert.ok(!process.env.PAYMONGO_SECRET_KEY && !process.env.XENDIT_SECRET_KEY);
  assert.ok(!process.env.RESEND_API_KEY &&
    !process.env.POSTMARK_SERVER_TOKEN && !process.env.SMTP_URL,
    "this proof must not contact an external email provider");
}

async function employeeActor(org, employeeId, makeSession, label) {
  const [actor] = await db.insert(users).values({
    email: "ess-isolation-" + label + "-" + randomUUID() + "@example.invalid",
    name: "Fictional ESS " + label, passwordHash: "not-a-real-password",
    role: "employee", employeeId,
  }).returning({ id: users.id, name: users.name });
  await db.insert(userOrganizations).values({
    userId: actor.id, organizationId: org.id, role: "employee", active: true,
  });
  const session = await makeSession(actor.id, { privileged: true });
  return { actor, org, employeeId, cookie: session.cookie };
}

const readTenantRows = (table, orgId) => db.select().from(table)
  .where(eq(table.organizationId, orgId)).orderBy(table.id);

async function snapshot(orgId) {
  return {
    cases: await readTenantRows(statutoryContributionIssueCases, orgId),
    events: await readTenantRows(statutoryContributionIssueEvents, orgId),
    remittanceBatches: await readTenantRows(statutoryRemittanceBatches, orgId),
    remittanceMembers: await readTenantRows(statutoryRemittanceMembers, orgId),
    ids: await readTenantRows(essIdentifierRequests, orgId),
    tasks: await readTenantRows(complianceActionTasks, orgId),
    audit: await readTenantRows(auditEvents, orgId),
    outbox: await readTenantRows(outbox, orgId),
  };
}

function noLeak(response, sentinel) {
  assert.ok(!response.text.includes(sentinel), "victim case marker leaked into HTTP body");
  assert.ok(![...response.headers].some(([k, v]) => (k + ": " + v).includes(sentinel)),
    "victim marker leaked into HTTP headers");
}

async function submitIdentifier({ request, expectStatus }, actor, kind, value, extra = {}) {
  const result = expectStatus(await request("/api/self/identifiers", {
    method: "POST", cookie: actor.cookie, body: { kind, value, ...extra },
  }), 201, "employee can submit their own government/optional ID review request");
  assert.equal(result.json?.status, "pending");
  assert.ok(Number.isSafeInteger(result.json?.id) && result.json.id > 0);
  assert.ok(!result.text.includes(value), "raw identifier must not be returned");
  const [stored] = await db.select().from(essIdentifierRequests)
    .where(eq(essIdentifierRequests.id, result.json.id)).limit(1);
  assert.equal(stored?.organizationId, actor.org.id);
  assert.equal(stored?.employeeId, actor.employeeId);
  assert.equal(stored?.requestedByUserId, actor.actor.id);
  assert.equal(stored?.kind, kind);
  assert.ok(stored?.proposedEncrypted && !stored.proposedEncrypted.includes(value),
    "identity review must persist encrypted, not plaintext, values");
  return stored;
}

async function submitCase({ request, expectStatus }, actor, marker, month, extra = {}) {
  const result = expectStatus(await request("/api/self/contribution-issues", {
    method: "POST", cookie: actor.cookie,
    body: {
      agency: "SSS", applicableMonth: month, issueType: "missing_posting",
      description: marker + " synthetic contribution posted to the wrong month.",
      ...extra,
    },
  }), 201, "linked employee can create a real own contribution-case row");
  assert.ok(Number.isSafeInteger(result.json?.case?.id) && result.json.case.id > 0);
  const [saved] = await db.select().from(statutoryContributionIssueCases)
    .where(eq(statutoryContributionIssueCases.id, result.json.case.id)).limit(1);
  assert.equal(saved?.organizationId, actor.org.id);
  assert.equal(saved?.employeeId, actor.employeeId);
  assert.equal(saved?.reportedByUserId, actor.actor.id);
  assert.ok(saved.description.includes(marker), "persist own discriminating marker");
  return saved;
}

async function readOwn({ request, expectStatus }, actor, ownIds, ownCases, victimEmployeeId, victimOrgId, sentinel) {
  const idResponse = expectStatus(await request(
    "/api/self/identifiers?organizationId=" + victimOrgId + "&employeeId=" + victimEmployeeId,
    { cookie: actor.cookie },
  ), 200, "ID GET binds to session employee, not forged query selectors");
  for (const row of ownIds) assert.ok(idResponse.json?.requests?.some((r) =>
    r.id === row.id && r.kind === row.kind && r.proposedMasked),
  "populated own masked identifier must be returned");
  await assertExactMaskedIdentifierGet(idResponse, actor, ownIds, sentinel);
  const caseResponse = expectStatus(await request(
    "/api/self/contribution-issues?organizationId=" + victimOrgId + "&employeeId=" + victimEmployeeId,
    { cookie: actor.cookie },
  ), 200, "case GET must return populated own employee evidence");
  assert.equal(caseResponse.json?.userId, actor.actor.id);
  for (const row of ownCases) assert.ok(caseResponse.json?.cases?.some((r) =>
    r.id === row.id && r.description === row.description),
  "own contribution case cannot be replaced by an empty 200");
  noLeak(caseResponse, sentinel);
}

export async function verifyEssStatutoryIdentityIsolation(f, { request, expectStatus, makeSession }) {
  requireDisposable();
  assert.ok(f.victimEmployee.id > 6, "real victim-only employee ID must be above 6");
  const http = { request, expectStatus };
  const sentinel = "ESS-VICTIM-ONLY-" + randomUUID();
  const victim = await employeeActor(f.orgs[0], f.victimEmployee.id, makeSession, "victim");
  const attackers = [];
  for (const index of [1, 2]) attackers.push(await employeeActor(
    f.orgs[index], f.ownedEmployees[index - 1].id, makeSession, "attacker-" + index));

  // Real foreign remittance member, not an invented ID. Its employer and
  // employee FK are separately verified before attackers can reference it.
  const [victimBatch] = await db.insert(statutoryRemittanceBatches).values({
    organizationId: victim.org.id, legalEntityId: f.entities[0].id,
    agency: "SSS", applicableMonth: "2026-02", dueDate: "2026-03-15",
    snapshotHash: "0".repeat(64), createdBy: "Fictional ESS isolation",
  }).returning({ id: statutoryRemittanceBatches.id });
  const remittanceMembers = await db.insert(statutoryRemittanceMembers).values(
    f.victimEmployees.map(employee => ({
      batchId: victimBatch.id, organizationId: victim.org.id,
      legalEntityId: f.entities[0].id, employeeId: employee.id,
      employeeNo: employee.employeeNo,
      employeeShare: "100.00", employerShare: "150.00", totalContribution: "250.00",
    })),
  ).returning({ id: statutoryRemittanceMembers.id, organizationId: statutoryRemittanceMembers.organizationId,
    employeeId: statutoryRemittanceMembers.employeeId });
  assert.equal(remittanceMembers.length, 8, "all eight victim-only remittance members must be persisted");
  const victimMember = remittanceMembers.find(row => row.employeeId === victim.employeeId);
  assert.ok(victimMember?.id > 6 && victimMember.organizationId === victim.org.id,
    "genuine victim-only member must have a real persisted ID above six");
  const victimId = await submitIdentifier(http, victim, "passportNo", "FICTIONAL9001");
  const victimCase = await submitCase(http, victim, sentinel, "2026-02", {
    memberId: victimMember.id,
  });
  assert.equal(victimCase.remittanceMemberId, victimMember.id,
    "the victim's own linked contribution issue must persist its genuine remittance member");
  await readOwn(http, victim, [victimId], [victimCase],
    victim.employeeId, victim.org.id, "NOT-USED-IN-VICTIM-POSITIVE");
  const victimBefore = await snapshot(victim.org.id);

  for (const [index, attacker] of attackers.entries()) {
    const marker = "ESS-OWN-" + index + "-" + randomUUID();
    const ownId = await submitIdentifier(http, attacker, "passportNo", "FICTATTACK" + (index + 1));
    const ownCase = await submitCase(http, attacker, marker, "2026-08");
    await readOwn(http, attacker, [ownId], [ownCase],
      victim.employeeId, victim.org.id, sentinel);

    // Explicitly forged ID selectors must not become authority. Legitimate
    // own 201 writes are required, not only 403/404 negative requests.
    const forgedId = await submitIdentifier(http, attacker,
      "driversLicenseNo", "FICTDRIVER" + (index + 1), {
        organizationId: victim.org.id, employeeId: victim.employeeId,
        requestedByUserId: victim.actor.id,
      });
    const forgedCase = await submitCase(http, attacker, marker + "-FORGED", "2026-07", {
      organizationId: victim.org.id, employeeId: victim.employeeId,
      reportedByUserId: victim.actor.id,
    });
    assert.equal(forgedId.organizationId, attacker.org.id);
    assert.equal(forgedCase.organizationId, attacker.org.id);
    await readOwn(http, attacker, [ownId, forgedId], [ownCase, forgedCase],
      victim.employeeId, victim.org.id, sentinel);

    const forbiddenMember = expectStatus(await request("/api/self/contribution-issues", {
      method: "POST", cookie: attacker.cookie,
      body: {
        agency: "SSS", applicableMonth: "2026-02",
        issueType: "unexpected_deduction",
        description: marker + " forged real victim remittance member is forbidden.",
        memberId: victimMember.id,
        organizationId: attacker.org.id, employeeId: attacker.employeeId,
      },
    }), 404, "real other-employer remittance member ID must be denied");
    noLeak(forbiddenMember, sentinel);
    assert.deepEqual(await snapshot(victim.org.id), victimBefore,
      "attacker identity/case reads and forged writes must not alter victim DB");
  }

  // Revoke the *old* employer while preserving a second active grant. The
  // exact same session must stay valid, but old employer data must be denied.
  await db.insert(userOrganizations).values({
    userId: victim.actor.id, organizationId: attackers[0].org.id,
    role: "employee", active: true,
  });
  const revoked = await db.update(userOrganizations).set({ active: false })
    .where(and(eq(userOrganizations.userId, victim.actor.id),
      eq(userOrganizations.organizationId, victim.org.id)))
    .returning({ id: userOrganizations.id });
  assert.equal(revoked.length, 1, "revoke precisely one old employer grant");
  const active = await db.select({ id: userOrganizations.id }).from(userOrganizations)
    .where(and(eq(userOrganizations.userId, victim.actor.id),
      eq(userOrganizations.organizationId, attackers[0].org.id),
      eq(userOrganizations.active, true)));
  assert.equal(active.length, 1, "second employer grant must remain active");
  const session = expectStatus(await request("/api/auth/me", { cookie: victim.cookie }),
    200, "a second employer keeps the same authenticated session active");
  assert.equal(session.json?.user?.id, victim.actor.id);

  const revokedIdentifiersGet = expectStatus(await request("/api/self/identifiers", {
    cookie: victim.cookie,
  }), 403, "revoked employer membership blocks old-employer GET identifiers");
  noLeak(revokedIdentifiersGet, sentinel);
  const revokedContributionGet = expectStatus(await request("/api/self/contribution-issues", {
    cookie: victim.cookie,
  }), 403, "revoked employer membership blocks old-employer GET contribution issues");
  noLeak(revokedContributionGet, sentinel);
  const idDenied = expectStatus(await request("/api/self/identifiers", {
    method: "POST", cookie: victim.cookie, body: { kind: "tin", value: "123456789" },
  }), 403, "revoked employer membership blocks identity POST");
  noLeak(idDenied, sentinel);
  const caseDenied = expectStatus(await request("/api/self/contribution-issues", {
    method: "POST", cookie: victim.cookie,
    body: {
      agency: "SSS", applicableMonth: "2026-06", issueType: "other",
      description: sentinel + " former employer case must never be created.",
    },
  }), 403, "revoked employer membership blocks contribution case POST");
  noLeak(caseDenied, sentinel);
  assert.deepEqual(await snapshot(victim.org.id), victimBefore,
    "all denied old-employer requests leave cases, events, identities, audits, tasks and outbox unchanged");
  console.log("ESS TENANT PASS: 4 methods; 2 attackers; own HTTP/SQL success; forged selectors; revoked-session denial; victim unchanged; fictional PG16 only");
}

// Keep the originally reviewed source-pinned contribution-case requests at
// their exact lines. Additional ESS identifier GET checks live separately so
// unrelated credited HTTP evidence cannot drift when this GAP proof grows.
async function assertExactMaskedIdentifierGet(idResponse, actor, ownIds, sentinel) {
  // Earlier suites may already have placed legitimate requests for the same
  // fictional employee in this shared database. The expected set must be
  // independently read from PostgreSQL, not inferred from writes by this step.
  // This still fails if GET leaks even one foreign employee's request ID.
  const persisted = await db.select({
    id: essIdentifierRequests.id,
    kind: essIdentifierRequests.kind,
    status: essIdentifierRequests.status,
    proposedEncrypted: essIdentifierRequests.proposedEncrypted,
  }).from(essIdentifierRequests).where(and(
    eq(essIdentifierRequests.organizationId, actor.org.id),
    eq(essIdentifierRequests.employeeId, actor.employeeId),
  )).orderBy(essIdentifierRequests.id);
  assert.ok(persisted.length >= ownIds.length,
    "every newly created owned identifier must still exist in the same employee's DB scope");
  assert.ok(persisted.length <= 40,
    "this finite synthetic fixture must fit the GET route's explicit 40-row limit");
  for (const own of ownIds) assert.ok(persisted.some((row) =>
    row.id === own.id && row.kind === own.kind && row.status === own.status),
  "newly submitted own request must match persisted employee, kind and status");

  const actualIds = idResponse.json?.requests;
  assert.ok(Array.isArray(actualIds), "identifier GET must return a request array");
  assert.equal(new Set(actualIds.map((row) => row.id)).size, actualIds.length,
    "GET cannot duplicate a request ID");
  assert.deepEqual(
    actualIds.map((row) => row.id).sort((a, b) => a - b),
    persisted.map((row) => row.id).sort((a, b) => a - b),
    "identifier GET must return exactly the employee's PostgreSQL-scoped requests; never foreign, missing or invented IDs",
  );
  for (const row of persisted) {
    const actual = actualIds.find((r) => r.id === row.id);
    assert.equal(actual?.kind, row.kind, "identifier kind must match persisted own evidence");
    assert.equal(actual?.status, row.status, "identifier review status must not be substituted");
    assert.ok(actual?.proposedMasked, "persisted identifier must be masked in GET");
    assert.notEqual(actual?.proposedMasked, row.proposedEncrypted,
      "response must not expose the actual encrypted identifier as its mask");
    assert.ok(!Object.hasOwn(actual, "proposedEncrypted"),
      "encrypted identifier ciphertext must not be exposed in GET");
  }
  // The server may normalize "private, no-store" to "no-store, max-age=0".
  // Enforce the non-storage directive, not a specific header serialization;
  // reject contradictory shared-cache instructions even alongside no-store.
  const cacheDirectives = (idResponse.headers.get("cache-control") ?? "")
    .split(",").map((directive) => directive.trim().toLowerCase());
  assert.ok(cacheDirectives.includes("no-store"),
    "sensitive identifier response must explicitly forbid cache storage");
  assert.ok(!cacheDirectives.includes("public") &&
    !cacheDirectives.some((directive) => directive.startsWith("s-maxage")),
    "sensitive identifier response cannot authorize shared-cache storage");
  assert.ok(!idResponse.text.includes("FICTIONAL9001") &&
    !idResponse.text.includes("FICTATTACK") &&
    !idResponse.text.includes("FICTDRIVER"),
    "no fictional raw identifier from any tenant may appear in GET");
  noLeak(idResponse, sentinel);
}
