/**
 * MNY-02 POST treasury-controls: real HTTP + disposable PostgreSQL 16.
 * Two separate fictional owners, nonempty higher-ID victim policy, same-tenant
 * role/MFA denials, forged cross-employer operator references, immutable DB,
 * valid enable/disable/re-enable actions and zero payment/provider operations.
 *
 * No manifest change or earned coverage credit. Review only.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ENDPOINT, requireDisposableTreasury, assertTreasuryDenied,
  assertNoTreasuryLeak, assertUnchangedTreasury, assertSavedTreasury,
} from "./tenant-mny02-treasury-contract.mjs";

export async function proveMny02Treasury() {
  // Must refuse unsafe configurations BEFORE importing a database pool.
  requireDisposableTreasury();
  const [{ db, pool }, s, t, { and, eq, asc, inArray }, { auditBusinessSnapshot }] =
    await Promise.all([
      import("../../src/db/index.ts"),
      import("../../src/db/schema.ts"),
      import("./tenant-table-http.mjs"),
      import("drizzle-orm"),
      import("./tenant-table-invariants.mjs"),
    ]);
  const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
  const byOrg = async (table, organizationId) => db.select().from(table)
    .where(eq(table.organizationId, organizationId))
    .orderBy(asc(table.id ?? table.organizationId));
  async function snapshot(organizationId) {
    const [organizations, staff, payProfiles, payroll, payoutChanges,
      memberships, policies, assignments, rawAudit] = await Promise.all([
      db.select().from(s.organizations).where(eq(s.organizations.id, organizationId)),
      byOrg(s.employees, organizationId),
      byOrg(s.employeePayProfiles, organizationId),
      byOrg(s.payrollRuns, organizationId),
      byOrg(s.employeePayoutChangeRequests, organizationId),
      byOrg(s.userOrganizations, organizationId),
      byOrg(s.treasuryControlPolicies, organizationId),
      byOrg(s.treasuryOperatorAssignments, organizationId),
      byOrg(s.auditEvents, organizationId),
    ]);
    const members = await db.select().from(s.users)
      .where(inArray(s.users.id, memberships.map(row => row.userId)))
      .orderBy(asc(s.users.id));
    return {
      organizations, staff, payProfiles, payroll, payoutChanges,
      memberships, members, policies, assignments, audit: auditBusinessSnapshot(rawAudit),
    };
  }
  async function seed(label) {
    const e = await t.seedEmployer(label, nonce, t.standaloneMakeSession);
    const [operator] = await db.insert(s.users).values({
      name: e.marker + " distinct treasury operator",
      email: (e.marker + "-treasury@example.invalid").toLowerCase(),
      passwordHash: "fictional-only-no-password-login",
      role: "bookkeeper", active: true, totpEnabled: true,
    }).returning();
    await db.insert(s.userOrganizations).values({
      userId: operator.id, organizationId: e.org.id,
      role: "bookkeeper", orgUnitId: null, active: true,
    });
    const session = await t.standaloneMakeSession(operator.id);
    await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
      .where(eq(s.sessions.id, session.id));
    return { ...e, operator: { ...operator, cookie: session.cookie } };
  }
  const body = (e, overrides = {}) => ({
    action: "save-policy", organizationId: e.org.id, enabled: true,
    requireReleaseSubmitterSeparation: true,
    operatorUserIds: [e.operator.id],
    ...overrides,
  });
  const post = (e, payload, path = ENDPOINT, cookie = e.cookie) =>
    t.standaloneRequest(path, { method: "POST", body: payload, cookie });
  const protectedMarkers = e => [e.marker, e.owner.email, e.operator.email];
  try {
    const pg = await pool.query("show server_version_num");
    const major = Math.floor(Number(pg.rows[0].server_version_num) / 10000);
    assert.equal(major, 16,
      "MNY02_TREASURY_REFUSED: execution must use disposable PostgreSQL 16");
    assert.equal((await db.select({ id: s.organizations.id }).from(s.organizations).limit(1)).length, 0,
      "MNY02_TREASURY_REFUSED: expected empty disposable company database");

    const a = await seed("ATTA");
    const b = await seed("ATTB");
    // Truly persisted fixture employers consume IDs so the later victim has
    // independent >6 organization, owner, employee, and operator identities.
    for (let index = 0; index < 6; index++)
      await t.seedEmployer("FILL" + index, nonce, t.standaloneMakeSession);
    const victim = await seed("VICTIM");
    assert.ok(victim.org.id > 6 && victim.owner.id > 6 &&
      victim.worker.id > 6 && victim.operator.id > 6);
    for (const e of [a, b]) {
      assert.ok(e.org.id < victim.org.id);
      assert.ok(e.owner.id < victim.owner.id);
      assert.notEqual(e.cookie, victim.cookie);
      assert.notEqual(e.cookie, b === e ? a.cookie : b.cookie);
    }

    // Nonempty real victim policy and real linked operator, created through
    // the same audited production-mode HTTP handler, not a fabricated 403.
    const victimBeforeOwn = await snapshot(victim.org.id);
    const victimSuccess = await post(victim, body(victim));
    assertSavedTreasury(victimBeforeOwn, await snapshot(victim.org.id),
      victimSuccess, victim, {
        enabled: true, separation: true, operatorUserIds: [victim.operator.id],
      });
    const victimBeforeAttacks = await snapshot(victim.org.id);
    assert.equal(victimBeforeAttacks.assignments.filter(row => row.active).length, 1);

    let ownedWrites = 0, foreignDenials = 0, forgedOperatorDenials = 0;
    const assertVictim = async label => {
      assertUnchangedTreasury(victimBeforeAttacks, await snapshot(victim.org.id),
        label + " cannot change the real higher-ID victim");
    };
    for (const e of [a, b]) {
      const other = e === a ? b : a;
      // Exact cross-employer POST denial using a REAL higher-ID employer and
      // its already persisted policy / real bookkeeper user ID.
      const beforeCross = await snapshot(e.org.id);
      const cross = await post(e, body(victim));
      assertTreasuryDenied(cross, 403, protectedMarkers(victim));
      assertUnchangedTreasury(beforeCross, await snapshot(e.org.id), "foreign employer POST");
      await assertVictim("foreign employer POST");
      foreignDenials++;

      // Forged victim operator ID within the signed-in employer is rejected.
      const forged = await post(e, body(e, { operatorUserIds: [victim.operator.id] }));
      assertTreasuryDenied(forged, 400, protectedMarkers(victim));
      assertUnchangedTreasury(beforeCross, await snapshot(e.org.id), "stolen victim operator");
      await assertVictim("stolen real victim operator");
      forgedOperatorDenials++;

      const stolenPeer = await post(e, body(e, { operatorUserIds: [other.operator.id] }));
      assertTreasuryDenied(stolenPeer, 400, protectedMarkers(victim));
      assertUnchangedTreasury(beforeCross, await snapshot(e.org.id), "other attacker operator");
      await assertVictim("stolen other real employer operator");

      const notAnAction = await post(e, body(e, { action: "release-payroll" }));
      assertTreasuryDenied(notAnAction, 400, protectedMarkers(victim));
      assertUnchangedTreasury(beforeCross, await snapshot(e.org.id), "unsupported payroll action");
      await assertVictim("unsupported action");

      // A sole owner cannot both be the assigned operator and the release actor.
      const selfApproval = await post(e, body(e, { operatorUserIds: [e.owner.id] }));
      assertTreasuryDenied(selfApproval, 409, protectedMarkers(victim));
      assertUnchangedTreasury(beforeCross, await snapshot(e.org.id), "no independent operator");
      await assertVictim("maker/checker separation blocked");

      // A same-company bookkeeper has a genuine active grant but is NOT an
      // owner and cannot save a policy, even after session MFA verification.
      const nonOwner = await post(e, body(e), ENDPOINT, e.operator.cookie);
      assertTreasuryDenied(nonOwner, 403, protectedMarkers(victim));
      assert.match(nonOwner.json.error, /owner/i);
      assertUnchangedTreasury(beforeCross, await snapshot(e.org.id), "same-company bookkeeper");
      await assertVictim("insufficient role");

      // An authenticated owner with a newly created but unverified MFA session
      // is also denied. Do not disable privileged MFA to make the proof pass.
      const unverified = await t.standaloneMakeSession(e.owner.id);
      const noMfa = await post(e, body(e), ENDPOINT, unverified.cookie);
      assertTreasuryDenied(noMfa, 403, protectedMarkers(victim));
      assert.equal(noMfa.json.code, "MFA_REQUIRED");
      assertUnchangedTreasury(beforeCross, await snapshot(e.org.id), "missing MFA");
      await assertVictim("MFA missing");

      const own = await post(e, body(e));
      assertSavedTreasury(beforeCross, await snapshot(e.org.id), own, e, {
        enabled: true, separation: true, operatorUserIds: [e.operator.id],
        foreignMarkers: protectedMarkers(victim),
      });
      await assertVictim("own persisted enabled policy");
      ownedWrites++;

      // Body and query attempt to override actor/user/employer, but the
      // actual written organization and audit must remain the signed-in own
      // employer. Duplicate own operator IDs are normalized, not multiplied.
      const query = ENDPOINT + "?organizationId=" + victim.org.id +
        "&userId=" + victim.owner.id + "&operatorUserId=" + victim.operator.id;
      const ownBeforeForgery = await snapshot(e.org.id);
      const forgedQuery = await post(e, body(e, {
        operatorUserIds: [e.operator.id, e.operator.id],
        actorUserId: victim.owner.id, targetOrganizationId: victim.org.id,
      }), query);
      assertSavedTreasury(ownBeforeForgery, await snapshot(e.org.id), forgedQuery, e, {
        enabled: true, separation: true, operatorUserIds: [e.operator.id],
        foreignMarkers: protectedMarkers(victim),
      });
      await assertVictim("forged body and query selectors");

      if (e === a) {
        // A real pending payout destination change blocks disabling the
        // policy, even though this fixture never initiates a payout.
        const [pending] = await db.insert(s.employeePayoutChangeRequests).values({
          organizationId: e.org.id, employeeId: e.worker.id,
          status: "pending", reason: "CI fictional pending destination review",
          originalSnapshot: { fixture: true }, originalStateSha256: "a".repeat(64),
          requestedByUserId: e.owner.id, requestedByName: e.owner.name,
        }).returning();
        const beforeBlock = await snapshot(e.org.id);
        const block = await post(e, body(e, { enabled: false, operatorUserIds: [] }));
        assertTreasuryDenied(block, 409, protectedMarkers(victim));
        assert.equal(block.json.payoutDestinationChangeRequestId, pending.id);
        assertUnchangedTreasury(beforeBlock, await snapshot(e.org.id),
          "real pending destination change must block policy disable");
        await assertVictim("pending payout change guard");
        await db.delete(s.employeePayoutChangeRequests)
          .where(and(eq(s.employeePayoutChangeRequests.id, pending.id),
            eq(s.employeePayoutChangeRequests.organizationId, e.org.id)));
      }

      const beforeDisabled = await snapshot(e.org.id);
      const disabled = await post(e, body(e, { enabled: false, operatorUserIds: [] }));
      assertSavedTreasury(beforeDisabled, await snapshot(e.org.id), disabled, e, {
        enabled: false, separation: true, operatorUserIds: [],
        foreignMarkers: protectedMarkers(victim),
      });
      await assertVictim("real owner disable without provider or money");

      // The method also supports the explicit non-separation option and
      // single-owner operator assignment. This is still synthetic policy only.
      const beforeReenable = await snapshot(e.org.id);
      const enabledNoSeparation = await post(e, body(e, {
        enabled: true, requireReleaseSubmitterSeparation: false,
        operatorUserIds: [e.owner.id],
      }));
      assertSavedTreasury(beforeReenable, await snapshot(e.org.id),
        enabledNoSeparation, e, {
          enabled: true, separation: false, operatorUserIds: [e.owner.id],
          foreignMarkers: protectedMarkers(victim),
        });
      await assertVictim("re-enabled alternative separation configuration");

      const ownRead = await t.standaloneRequest(
        ENDPOINT + "?organizationId=" + e.org.id, { cookie: e.cookie });
      assert.equal(ownRead.status, 200);
      assert.equal(ownRead.json.policy.enabled, true);
      assert.deepEqual(ownRead.json.operatorUserIds, [e.owner.id]);
      assert.equal(ownRead.json.canConfigure, true);
      assertNoTreasuryLeak(ownRead, protectedMarkers(victim));

      // Same authenticated owner session, but former-employer membership
      // deactivated: no new policy change or audit event can occur.
      await db.update(s.userOrganizations).set({ active: false }).where(and(
        eq(s.userOrganizations.userId, e.owner.id),
        eq(s.userOrganizations.organizationId, e.org.id),
      ));
      const beforeRevoked = await snapshot(e.org.id);
      const revoked = await post(e, body(e, { enabled: false, operatorUserIds: [] }));
      assertTreasuryDenied(revoked, 403, protectedMarkers(victim));
      assertUnchangedTreasury(beforeRevoked, await snapshot(e.org.id),
        "revoked owner session cannot change policy");
      await assertVictim("revoked former employer");
    }
    assert.equal(ownedWrites, 2);
    assert.equal(foreignDenials, 2);
    assert.equal(forgedOperatorDenials, 2);
    assert.equal((await snapshot(victim.org.id)).payroll.length, 0);
    assert.equal((await snapshot(victim.org.id)).payoutChanges.length, 0);
    console.log("MNY02_TREASURY_PROOF_OK: two own positive policies, actual high-ID victim 403, forged operator 400, MFA/role/revocation 403, persisted audit, no money");
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith("tenant-mny02-treasury-http.mjs")) {
  proveMny02Treasury().catch(error => {
    console.error("MNY02_TREASURY_PROOF_FAILED:", error);
    process.exitCode = 1;
  });
}
