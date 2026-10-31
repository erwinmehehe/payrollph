/**
 * WFM Demand read authorization overlay, independent SEC family batch.
 * Synthetic PG16 only; two real owner sessions, higher-ID victim and excluded
 * employer from the reviewed allowlisted-read bootstrap. No provider or money.
 * Adds ZERO credits and does not mutate policy approvals, shifts or payroll.
 */
import assert from "node:assert/strict";
import {
  requireDisposableDemandRecovery, assertDemandDenial,
  assertBoundDemandRead, assertImmutableDemandSources,
} from "./tenant-demand-governance-recovery-contract.mjs";
import { createRows } from "./tenant-table-rows/read/demand-governance.mjs";

const plain = value => JSON.parse(JSON.stringify(value));

export async function proveWorkforceDemandReadPermissionOverlay() {
  // The first executable step must refuse non-disposable environments.
  requireDisposableDemandRecovery();
  assert.equal(process.env.TENANT_WFM_DEMAND_READ_OVERLAY_PROOF, "fictional-only");
  const [database, s, drizzle, helpers, invariants] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
    import("./tenant-table-invariants.mjs"),
  ]);
  const { db, pool } = database;
  const { and, asc, eq } = drizzle;
  const request = helpers.standaloneRequest;
  try {
    const version = await pool.query("SHOW server_version_num");
    assert.equal(Math.floor(Number(version.rows[0]?.server_version_num) / 10000), 16,
      "Actual ephemeral PostgreSQL 16 is required");

    const [victim, a, b] = invariants.readAllowlistPreseed(
      process.env.TENANT_TABLE_ALLOWLIST_FIXTURE);
    const excluded = invariants.readPrivateAllowlistFixture(
      process.env.TENANT_TABLE_ALLOWLIST_FIXTURE).excluded;
    const subjects = [a, b, victim, excluded];
    assert.ok(victim.org.id > a.org.id && victim.org.id > b.org.id);
    assert.ok(!process.env.PAYMONGO_SECRET_KEY && !process.env.XENDIT_SECRET_KEY,
      "External provider credentials prohibited");

    const rows = createRows({ assert, db, rowTables: s });
    assert.deepEqual(rows.map(row => row.key), [
      "GET workforce/demand-observations/issued",
      "GET workforce/demand-staffing/policies",
    ]);
    for (const row of rows) {
      // Real SQL rows are inserted attacker-first, victim-last.
      for (const employer of [a, b, victim])
        employer.seeded[row.key] = await row.seed(employer);
      assert.ok(victim.seeded[row.key].id > a.seeded[row.key].id &&
        victim.seeded[row.key].id > b.seeded[row.key].id,
      "Real victim-only source ID must exceed both attackers");
      assert.ok(victim.seeded[row.key].siteId > a.seeded[row.key].siteId &&
        victim.seeded[row.key].siteId > b.seeded[row.key].siteId,
      "Real victim-only worksite ID must exceed both attackers");
    }

    const sourceTables = [
      "organizations", "worksites", "jobProfiles", "employees",
      "employeePayProfiles", "workforceDemandForecastIssues",
      "workforceDemandForecastScores", "workforceDemandObservationRevisions",
      "workforceDemandStaffingPolicies", "workforceDemandStaffingPolicyEvents",
      "userOrganizations", "permissionSets", "userPermissionAssignments",
      "auditEvents", "payrollRuns", "employeeScheduleAssignments",
    ];
    async function snapshot(orgId) {
      const out = {};
      for (const name of sourceTables) {
        const table = s[name];
        assert.ok(table?.id, "Required real SQL source missing: " + name);
        out[name] = await db.select().from(table)
          .where(eq(name === "organizations" ? table.id : table.organizationId, orgId))
          .orderBy(asc(table.id));
      }
      return plain(out);
    }
    async function freeze() {
      return new Map(await Promise.all(subjects.map(async subject =>
        [subject.org.id, await snapshot(subject.org.id)])));
    }
    async function unchanged(before, label) {
      for (const subject of subjects) {
        assertImmutableDemandSources(before.get(subject.org.id),
          await snapshot(subject.org.id), label + ": " + subject.marker);
      }
    }
    const beforeReads = await freeze();
    const endpoint = (row, organizationId, query) =>
      "/api/" + row.key.slice(4) + "?organizationId=" + organizationId + "&" + query;
    const responseWithoutMarkers = (response, label) => {
      for (const subject of subjects) {
        assert.ok(!response.text.includes(subject.marker),
          label + " must not contain a fictional employer's protected marker");
      }
    };
    let ownPositives = 0, realForeign403 = 0, stolenWorksite403 = 0;
    for (const actor of [a, b]) {
      const signedIn = await request("/api/account", { cookie: actor.cookie });
      assert.equal(signedIn.status, 200, "Real independent attacker session must authenticate");
      assert.equal(signedIn.json?.profile?.id, actor.owner.id);
      for (const row of rows) {
        const kind = row.key.includes("observations") ? "issued" : "policy";
        const c = {
          orgId: actor.org.id, seeded: actor.seeded[row.key],
          victimSeeded: victim.seeded[row.key], victim,
          forbiddenMarkers: [actor === a ? b.marker : a.marker],
        };
        const own = await request(endpoint(row, actor.org.id, row.query(c)),
          { cookie: actor.cookie });
        assert.equal(own.status, 200, "Real own populated source GET must succeed");
        row.prove(own, c);
        const persisted = beforeReads.get(actor.org.id)[
          kind === "issued" ? "workforceDemandForecastIssues" : "workforceDemandStaffingPolicies"
        ].find(entry => entry.id === c.seeded.id);
        assertBoundDemandRead(kind, own, c, persisted);
        ownPositives++;

        // The victim's real employer IS allowlisted, so denial is an
        // authorization result, not a feature-OFF false positive.
        const foreign = await request(endpoint(row, victim.org.id,
          row.foreignQuery(c)), { cookie: actor.cookie });
        assertDemandDenial(foreign, 403, subjects.map(e => e.marker));
        realForeign403++;

        const stolenSite = await request(endpoint(row, actor.org.id,
          row.foreignQuery(c)), { cookie: actor.cookie });
        assertDemandDenial(stolenSite, 403, subjects.map(e => e.marker));
        stolenWorksite403++;

        const anonymous = await request(endpoint(row, actor.org.id, row.query(c)));
        assertDemandDenial(anonymous, 401, subjects.map(e => e.marker));
      }
    }
    assert.equal(ownPositives, 4);
    assert.equal(realForeign403, 4);
    assert.equal(stolenWorksite403, 4);
    await unchanged(beforeReads, "own and cross-employer GET");

    // Active, role-authorized A owner is denied by a deny-only custom
    // permission overlay on the SAME active membership and the SAME cookie.
    const [membership] = await db.select({ id: s.userOrganizations.id })
      .from(s.userOrganizations).where(and(
        eq(s.userOrganizations.userId, a.owner.id),
        eq(s.userOrganizations.organizationId, a.org.id),
        eq(s.userOrganizations.active, true),
      )).limit(1);
    assert.ok(membership?.id);
    const [overlay] = await db.insert(s.permissionSets).values({
      organizationId: a.org.id, name: "Fictional deny workforce " + a.marker,
      permissions: ["people.admin"], active: true, createdByUserId: a.owner.id,
    }).returning({ id: s.permissionSets.id });
    await db.insert(s.userPermissionAssignments).values({
      organizationId: a.org.id, userOrganizationId: membership.id,
      permissionSetId: overlay.id, assignedByUserId: a.owner.id,
    });
    const beforeOverlayGets = await freeze();
    assert.equal((await request("/api/account", { cookie: a.cookie })).status, 200,
      "Custom overlay may not invalidate the real signed-in session");
    for (const row of rows) {
      const c = { orgId: a.org.id, seeded: a.seeded[row.key] };
      const denied = await request(endpoint(row, a.org.id, row.query(c)),
        { cookie: a.cookie });
      assertDemandDenial(denied, 403, subjects.map(e => e.marker));
      assert.match(denied.json?.error ?? "", /custom permission set/i,
        "The active owner must be denied by the actual workforce permission overlay");
    }
    await unchanged(beforeOverlayGets, "custom permission denial");

    // Active manager has genuine own unit scope, but cannot read company-wide
    // draft management even when its employer is explicitly feature-ON.
    const [manager] = await db.insert(s.users).values({
      email: "wfm-demand-unit-" + a.marker.toLowerCase() + "@example.invalid",
      name: a.marker + " fictional unit manager", role: "owner",
      passwordHash: "fictional-session-only", totpEnabled: true,
    }).returning({ id: s.users.id });
    await db.insert(s.userOrganizations).values({
      userId: manager.id, organizationId: a.org.id,
      role: "manager", orgUnitId: a.unit.id, active: true,
    });
    const managerSession = await helpers.standaloneMakeSession(manager.id);
    await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
      .where(eq(s.sessions.id, managerSession.id));
    const ownPolicy = a.seeded[rows[1].key];
    const policyBase = endpoint(rows[1], a.org.id,
      "worksiteId=" + ownPolicy.siteId +
      "&jobProfileId=any&metricKind=transactions&intervalMinutes=60");
    const managerApproved = await request(policyBase + "&mode=approved",
      { cookie: managerSession.cookie });
    assert.equal(managerApproved.status, 200, "Active in-unit manager retains approved-only read");
    assert.equal(managerApproved.json?.readOnly, true);
    assert.deepEqual(managerApproved.json?.policies, [],
      "An unapproved draft must not appear as an approved policy");
    const managerManage = await request(policyBase + "&mode=manage",
      { cookie: managerSession.cookie });
    assertDemandDenial(managerManage, 403, subjects.map(e => e.marker));

    // Independently revoke B's active membership while keeping its same
    // browser cookie valid. Neither workforce GET can still read B's data.
    const revoked = await db.update(s.userOrganizations).set({ active: false })
      .where(and(
        eq(s.userOrganizations.userId, b.owner.id),
        eq(s.userOrganizations.organizationId, b.org.id),
        eq(s.userOrganizations.active, true),
      )).returning({ id: s.userOrganizations.id });
    assert.equal(revoked.length, 1, "Exactly one real owner grant must be revoked");
    const beforeRevokedGets = await freeze();
    const stillSignedIn = await request("/api/account", { cookie: b.cookie });
    assert.equal(stillSignedIn.status, 200, "Revoked employer grant must NOT revoke account session");
    assert.equal(stillSignedIn.json?.profile?.id, b.owner.id);
    for (const row of rows) {
      const c = { orgId: b.org.id, seeded: b.seeded[row.key] };
      const denied = await request(endpoint(row, b.org.id, row.query(c)),
        { cookie: b.cookie });
      assertDemandDenial(denied, 403, subjects.map(e => e.marker));
    }
    await unchanged(beforeRevokedGets, "revoked membership denial");
    assertImmutableDemandSources(beforeReads.get(victim.org.id),
      await snapshot(victim.org.id),
      "Protected victim source, payroll and audit never changed");

    const result = {
      kind: "WFM_DEMAND_GET_PERMISSION_OVERLAY_FICTIONAL_PG16",
      readMethods: rows.map(row => row.key), independentOwners: 2,
      realOwnedPopulatedReads: ownPositives, realForeign403,
      stolenWorksite403, ownActiveOverlayDenied: 2,
      scopedManagerApprovedOnly: true, revokedStillSignedInDenials: 2,
      victimSourcesPayrollAuditUnchanged: true,
      externalProviders: false, changedPayroll: false,
      methodCredits: 0, independentlyAccepted: false, productionCertified: false,
    };
    console.log("WFM_DEMAND_READ_OVERLAY_COMPLETE " + JSON.stringify(result));
    return result;
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/")
  .endsWith("/tenant-wfm-demand-read-overlay-http.mjs")) {
  proveWorkforceDemandReadPermissionOverlay().catch(error => {
    console.error("WFM_DEMAND_READ_OVERLAY_FAILED " +
      (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
}
