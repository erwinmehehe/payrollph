/**
 * POST invitations/accept: the bearer invitation, never the body or a pre-existing
 * cookie, determines the employer, role and unit of a newly created account.
 *
 * Disposable PostgreSQL 16 + production-mode localhost HTTP only. Two independent
 * fictional employers accept valid unit-scoped invitations; manually poisoned
 * invitations naming a different employer's unit, inactive units and invalid
 * tokens must not create any account, membership or audit event. A populated
 * higher-ID victim is never changed. No live mail or money provider is used.
 *
 * This adds proof and a route regression, NOT tenant-ledger coverage credit.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { requireDisposableApprovalTask } from "./tenant-approval-task-contract.mjs";

const ROUTE = "/api/invitations/accept";
const digest = (value) => createHash("sha256").update(value).digest("hex");

export async function verifyInvitationAcceptUnitBoundary() {
  // Must run before importing any DB or application modules.
  requireDisposableApprovalTask();
  const [{ db, pool }, schema, orm, fixture] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  const { auditEvents, employees, invitations, organizations, orgUnits, sessions, userOrganizations, users } = schema;
  const { eq, inArray } = orm;
  const { seedEmployer, standaloneMakeSession, standaloneRequest } = fixture;
  try {
    assert.equal((await db.select().from(users).limit(1)).length, 0,
      "INVITE_ACCEPT_REFUSED: requires a genuinely empty fictional user database");
    const nonce = randomUUID().replaceAll("-", "").slice(0, 9);
    const a = await seedEmployer("ATTA", nonce, standaloneMakeSession);
    const b = await seedEmployer("ATTB", nonce, standaloneMakeSession);
    // A real higher-ID victim prevents first-row and low-ID tests from passing by coincidence.
    for (let i = 0; i < 7; i++) {
      await db.insert(users).values({
        email: "invite-filler-" + i + "-" + nonce + "@example.invalid",
        name: "Filler " + i, passwordHash: "unusable-fixture", role: "employee",
      });
    }
    const victim = await seedEmployer("VICTIM", nonce, standaloneMakeSession);
    assert.ok(victim.owner.id > Math.max(a.owner.id, b.owner.id, 6));
    assert.ok(victim.org.id > Math.max(a.org.id, b.org.id));
    const inviteEmails = new Map();
    async function invite(employer, label, orgUnitId = employer.unit.id) {
      const email = "invite-" + label + "-" + nonce + "@example.invalid";
      const token = randomBytes(32).toString("hex");
      const [row] = await db.insert(invitations).values({
        organizationId: employer.org.id, email, role: "employee",
        orgUnitId, tokenHash: digest(token), invitedBy: employer.owner.name,
        expiresAt: new Date(Date.now() + 3_600_000),
      }).returning();
      const emails = inviteEmails.get(employer.org.id) ?? [];
      inviteEmails.set(employer.org.id, [...emails, email]);
      return { token, email, row };
    }
    const own = { a: await invite(a, "a-own"), b: await invite(b, "b-own") };
    const poisoned = { a: await invite(a, "a-poison", victim.unit.id), b: await invite(b, "b-poison", victim.unit.id) };
    // Do not rely on only three invitation IDs: the victim's invitation itself is high-ID.
    for (let i = 0; i < 7; i++) await invite(a, "filler-" + i);
    const victimInvitation = await invite(victim, "victim");
    assert.ok(victimInvitation.row.id > Math.max(own.a.row.id, own.b.row.id, 6));
    const [inactiveUnit] = await db.insert(orgUnits).values({
      organizationId: a.org.id, type: "department", name: "Inactive fixture",
      code: "inact-" + nonce, active: false,
    }).returning();
    const inactive = await invite(a, "a-inactive", inactiveUnit.id);

    async function snapshot(employer) {
      const orgId = employer.org.id;
      const emails = inviteEmails.get(orgId) ?? [];
      const accounts = emails.length
        ? await db.select().from(users).where(inArray(users.email, emails)).orderBy(users.id)
        : [];
      const accountIds = accounts.map((user) => user.id);
      return {
        organizations: await db.select().from(organizations).where(eq(organizations.id, orgId)).orderBy(organizations.id),
        units: await db.select().from(orgUnits).where(eq(orgUnits.organizationId, orgId)).orderBy(orgUnits.id),
        employees: await db.select().from(employees).where(eq(employees.organizationId, orgId)).orderBy(employees.id),
        invitations: await db.select().from(invitations).where(eq(invitations.organizationId, orgId)).orderBy(invitations.id),
        memberships: await db.select().from(userOrganizations).where(eq(userOrganizations.organizationId, orgId)).orderBy(userOrganizations.id),
        owner: await db.select().from(users).where(eq(users.id, employer.owner.id)),
        ownerSessions: await db.select().from(sessions).where(eq(sessions.userId, employer.owner.id)).orderBy(sessions.id),
        inviteeAccounts: accounts,
        inviteeSessions: accountIds.length
          ? await db.select().from(sessions).where(inArray(sessions.userId, accountIds)).orderBy(sessions.id)
          : [],
        audits: await db.select().from(auditEvents).where(eq(auditEvents.organizationId, orgId)).orderBy(auditEvents.id),
      };
    }
    const victimBefore = await snapshot(victim);
    const forbidden = [victim.marker, victim.owner.email, victimInvitation.email];
    const noLeak = (response) => {
      const text = response.text + "\n" + [...response.headers].map(([k, v]) => k + ":" + v).join("\n");
      for (const value of forbidden) assert.ok(!text.includes(value), "foreign account or employer leaked in response");
    };
    const post = (token, extra = {}) => standaloneRequest(ROUTE + "?organizationId=" + victim.org.id +
      "&orgUnitId=" + victim.unit.id + "&userId=" + victim.owner.id, {
      method: "POST",
      body: {
        token, name: "Accepted Fixture " + nonce, password: "FictionalStrongPass123!",
        organizationId: victim.org.id, orgUnitId: victim.unit.id,
        userId: victim.owner.id, email: victim.owner.email, role: "owner",
        ...extra,
      },
    });
    for (const [employer, key] of [[a, "a"], [b, "b"]]) {
      const before = await snapshot(employer);
      const result = await post(poisoned[key].token);
      assert.equal(result.status, 409, "foreign-unit invitation must be refused, not accepted");
      noLeak(result);
      assert.deepEqual(await snapshot(employer), before,
        "a poisoned cross-employer unit must not create, consume or audit anything");
      assert.deepEqual(await snapshot(victim), victimBefore, "victim unchanged after poisoned " + key);
    }
    const beforeInactive = await snapshot(a);
    const invalidUnit = await post(inactive.token);
    assert.equal(invalidUnit.status, 409, "inactive own unit must also fail closed");
    noLeak(invalidUnit);
    assert.deepEqual(await snapshot(a), beforeInactive, "inactive-unit invitation must be untouched");

    // Public mutation must refuse a cross-site request even if the token is valid.
    const crossSite = await fetch(new URL(ROUTE, process.env.SECURITY_SMOKE_URL), {
      method: "POST", redirect: "manual", cache: "no-store",
      headers: { origin: "https://attacker.example.test", "sec-fetch-site": "cross-site", "content-type": "application/json" },
      body: JSON.stringify({ token: own.a.token, name: "Blocked", password: "FictionalStrongPass123!" }),
    });
    const crossText = await crossSite.text();
    assert.equal(crossSite.status, 403, "cross-site acceptance must be refused");
    for (const value of forbidden) assert.ok(!crossText.includes(value));
    assert.deepEqual(await snapshot(a), beforeInactive, "cross-site attempt must not consume valid invitation");
    const invalid = await post(randomBytes(32).toString("hex"));
    assert.equal(invalid.status, 400, "unknown token must fail");
    noLeak(invalid);


    // Force a real PostgreSQL audit INSERT failure after the token claim and
    // user/membership inserts. These must all roll back as one transaction.
    const beforeVeto = await snapshot(a);
    await pool.query(`
      CREATE OR REPLACE FUNCTION qa_invite_audit_veto() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'Invitation accepted'
          AND NEW.resource LIKE 'invite-a-own-%@example.invalid' THEN
          RAISE EXCEPTION 'fictional invitation audit veto';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await pool.query(`
      CREATE TRIGGER qa_invite_audit_veto BEFORE INSERT ON audit_events
      FOR EACH ROW EXECUTE FUNCTION qa_invite_audit_veto()
    `);
    try {
      const auditDenied = await post(own.a.token);
      assert.equal(auditDenied.status, 409,
        "audit-veto failure must deny acceptance, not commit an unaudited account");
      assert.equal(auditDenied.headers.get("set-cookie"), null,
        "audit-veto rollback must not issue an authenticated session");
      noLeak(auditDenied);
      assert.deepEqual(await snapshot(a), beforeVeto,
        "audit-veto rollback must restore invitation, identity, membership and audit");
      assert.deepEqual(await snapshot(victim), victimBefore,
        "audit-veto rollback must never mutate the real higher-ID victim");
    } finally {
      await pool.query("DROP TRIGGER IF EXISTS qa_invite_audit_veto ON audit_events");
      await pool.query("DROP FUNCTION IF EXISTS qa_invite_audit_veto()");
    }

    const createdAccounts = [];
    for (const [employer, key, other] of [[a, "a", b], [b, "b", a]]) {
      const otherBefore = await snapshot(other);
      const beforeAudits = (await snapshot(employer)).audits.length;
      const response = await post(own[key].token);
      assert.equal(response.status, 200, "valid own invitation: " + response.text.slice(0, 200));
      assert.equal(response.json?.ok, true);
      assert.equal(response.json?.organizationId, employer.org.id, "forged organizationId was ignored");
      assert.equal(response.json?.validEmail, true);
      noLeak(response);
      const [account] = await db.select().from(users).where(eq(users.email, own[key].email));
      assert.ok(account?.id && account.id !== victim.owner.id && account.email === own[key].email);
      assert.equal(account.role, "employee", "forged privileged role must be ignored");
      const [grant] = await db.select().from(userOrganizations).where(eq(userOrganizations.userId, account.id));
      assert.equal(grant.organizationId, employer.org.id);
      assert.equal(grant.orgUnitId, employer.unit.id, "forged foreign org unit was ignored");
      assert.equal(grant.role, "employee");
      const [claimed] = await db.select().from(invitations).where(eq(invitations.id, own[key].row.id));
      assert.ok(claimed.acceptedAt, "own invitation must be consumed once");
      const audits = (await snapshot(employer)).audits;
      assert.equal(audits.length, beforeAudits + 1, "exactly one own audit event");
      assert.ok(audits.some((item) => item.action === "Invitation accepted" && item.resource === own[key].email));
      const cookieHeader = response.headers.get("set-cookie") ?? "";
      assert.match(cookieHeader, /__Host-linaw_session=/, "valid own acceptance issues a session");
      const acceptedCookie = cookieHeader.split(";")[0];
      assert.equal((await standaloneRequest("/api/account", { cookie: acceptedCookie })).status, 200,
        "new own account can use its real session");
      createdAccounts.push(account.id);
      const replay = await post(own[key].token);
      assert.equal(replay.status, 400, "consumed invitation must not create another account");
      noLeak(replay);
      const sameEmail = await db.select().from(users).where(eq(users.email, own[key].email));
      assert.equal(sameEmail.length, 1, "single-use token created exactly one account");
      assert.deepEqual(await snapshot(other), otherBefore, "other attacker unchanged after " + key + " journey");
      assert.deepEqual(await snapshot(victim), victimBefore, "victim unchanged after " + key + " journey");
    }
    assert.notEqual(createdAccounts[0], createdAccounts[1], "A and B prove independent own successes");
    assert.deepEqual(await snapshot(victim), victimBefore, "entire higher-ID victim remains byte-identical");
    assert.equal((await db.select().from(users).where(eq(users.email, victimInvitation.email))).length, 0,
      "victim invitation did not create an account");
    console.log(JSON.stringify({
      kind: "tenant-invitations-accept-unit-boundary", method: "POST invitations/accept",
      independentOwnSuccesses: 2, higherIdVictim: true, deniedForeignUnits: 2,
      deniedInactiveUnit: true, forgedSelectorsIgnored: true, singleUse: true,
      crossSiteDenied: true, victimUnchanged: true, auditVetoRolledBack: true, coverageCredits: 0,
      independentlyAccepted: false,
    }));
  } finally {
    await pool.end();
  }
}
if (process.argv[1]?.endsWith("tenant-invitations-accept-http.mjs")) {
  verifyInvitationAcceptUnitBoundary().catch((error) => { console.error(error); process.exitCode = 1; });
}
