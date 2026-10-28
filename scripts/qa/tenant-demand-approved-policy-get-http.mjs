/**
 * WRK-01 extra GET evidence only: approved (not draft) employer policy.
 * Disposable PG16 and localhost Next, with two signed-in attackers, one real
 * higher-ID victim, and a non-allowlisted employer. NO production or payroll.
 *
 * This is a source/QA candidate. An exact-head green run and independent owner
 * review are required before anyone changes the method's GAP classification.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { requireDisposableDemandRecovery } from "./tenant-demand-governance-recovery-contract.mjs";
import {
  APPROVED_POLICY_GET, assertApprovedPolicyHttp, assertApprovedPolicyDenial,
} from "./tenant-demand-approved-policy-get-contract.mjs";

const plain = value => JSON.parse(JSON.stringify(value));
const endpoint = (orgId, siteId, roleId, mode = "approved") =>
  "/api/workforce/demand-staffing/policies?organizationId=" + orgId +
  "&worksiteId=" + siteId + "&jobProfileId=" + roleId +
  "&metricKind=transactions&intervalMinutes=60&mode=" + mode;

export async function verifyApprovedStaffingPolicyGet() {
  // All provider, worker, target, feature and database checks run before any
  // app module or database is imported. Never point at a hosted endpoint.
  requireDisposableDemandRecovery();
  const [database, schema, drizzle, http, invariant, policies] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
    import("./tenant-table-invariants.mjs"),
    import("../../src/lib/workforce-demand-staffing-policy-server.ts"),
  ]);
  const { db, pool } = database;
  const { asc, eq, and } = drizzle;
  const request = http.standaloneRequest;
  try {
    const version = await pool.query("SHOW server_version_num");
    assert.equal(Math.floor(Number(version.rows[0]?.server_version_num) / 10000), 16,
      "APPROVED_POLICY_GET_REFUSED: an actual disposable PostgreSQL 16 server is required");
    const file = process.env.TENANT_TABLE_ALLOWLIST_FIXTURE;
    const [victim, a, b] = invariant.readAllowlistPreseed(file);
    const { excluded } = invariant.readPrivateAllowlistFixture(file);
    assert.ok(victim.org.id > Math.max(a.org.id, b.org.id));
    assert.ok(![a.org.id, b.org.id, victim.org.id].includes(excluded.org.id));
    for (const employer of [victim, a, b, excluded]) {
      assert.match(employer.cookie, /^__Host-linaw_session=[a-f0-9]{64}$/);
    }

    // Use the *application's* draft -> submit -> independent checker approve
    // lifecycle, not a guessed approved DB status or fabricated receipt.
    const seeded = new Map();
    for (const employer of [a, b, victim]) {
      const [site] = await db.insert(schema.worksites).values({
        organizationId: employer.org.id,
        orgUnitId: employer.unit.id,
        code: ("APR-" + employer.marker).slice(0, 32),
        name: employer.marker + " approved-policy-only fictional worksite",
        active: true, timezone: "Asia/Manila",
      }).returning();
      const [role] = await db.insert(schema.jobProfiles).values({
        organizationId: employer.org.id,
        title: employer.marker + " approved-policy fictional role",
        family: "General", level: "Individual Contributor", active: true,
      }).returning();
      const [checker] = await db.insert(schema.users).values({
        email: "checker-" + randomUUID() + "@example.invalid",
        name: employer.marker + " separate fictional policy checker",
        passwordHash: "disposable-test-only", role: "owner",
      }).returning({ id: schema.users.id });
      await db.insert(schema.userOrganizations).values({
        organizationId: employer.org.id, userId: checker.id,
        role: "owner", active: true,
      });
      const spec = {
        organizationId: employer.org.id, worksiteId: site.id,
        jobProfileId: role.id, metricKind: "transactions", intervalMinutes: 60,
        effectiveFrom: "2099-01-01", effectiveUntil: "2099-01-31",
        productiveUnitsPerWorkerHour: 6 + employer.rank,
        serviceTargetCoveragePercent: 70 + employer.rank,
        rationale: employer.marker + " independently checked fictional staffing policy",
        idempotencyKey: "APR-" + randomUUID().replaceAll("-", ""),
      };
      const access = {
        organizationId: employer.org.id, companyWide: true, orgUnitId: null,
      };
      const created = await policies.createStaffingPolicyDraft({
        spec, actorUserId: employer.owner.id, access,
      });
      assert.equal(created.status, "draft");
      assert.equal(created.replayed, false);
      const change = (action, decisionNote) => ({
        organizationId: employer.org.id, policyId: created.id,
        action, decisionNote, acknowledged: true,
      });
      const submitted = await policies.transitionStaffingPolicy({
        change: change("submit", ""), actorUserId: employer.owner.id,
        actorRole: "owner", access,
      });
      assert.equal(submitted.status, "submitted");
      const approved = await policies.transitionStaffingPolicy({
        change: change("approve", "Separate fictional checker validated exact employer scope"),
        actorUserId: checker.id, actorRole: "owner", access,
      });
      assert.equal(approved.status, "approved");
      assert.match(approved.approvalReceiptSha256, /^[a-f0-9]{64}$/);
      const [row] = await db.select().from(schema.workforceDemandStaffingPolicies)
        .where(and(
          eq(schema.workforceDemandStaffingPolicies.organizationId, employer.org.id),
          eq(schema.workforceDemandStaffingPolicies.id, created.id),
        )).limit(1);
      const [event] = await db.select().from(schema.workforceDemandStaffingPolicyEvents)
        .where(and(
          eq(schema.workforceDemandStaffingPolicyEvents.organizationId, employer.org.id),
          eq(schema.workforceDemandStaffingPolicyEvents.policyId, created.id),
          eq(schema.workforceDemandStaffingPolicyEvents.action, "approved"),
        )).limit(1);
      assert.equal(row.status, "approved");
      assert.equal(row.decidedByUserId, checker.id);
      assert.equal(row.proposedByUserId, employer.owner.id);
      assert.notEqual(checker.id, employer.owner.id);
      assert.equal(event.actorUserId, checker.id);
      assert.equal(event.receiptSha256, approved.approvalReceiptSha256);
      assert.equal(event.policySha256, row.contentSha256);
      seeded.set(employer.org.id, {
        organizationId: employer.org.id, worksiteId: site.id,
        jobProfileId: role.id, id: created.id, version: created.version,
        contentSha256: row.contentSha256,
        approvalReceiptSha256: event.receiptSha256,
        effectiveFrom: String(row.effectiveFrom),
        effectiveUntil: String(row.effectiveUntil),
        productiveUnitsPerWorkerHour: Number(row.productiveUnitsPerWorkerHour),
        serviceTargetCoveragePercent: Number(row.serviceTargetCoveragePercent),
        rationale: row.rationale,
      });
    }
    assert.ok(seeded.get(victim.org.id).id >
      Math.max(seeded.get(a.org.id).id, seeded.get(b.org.id).id),
      "victim-only approved policy must exist with a genuinely higher SQL ID");
    assert.ok(seeded.get(victim.org.id).worksiteId >
      Math.max(seeded.get(a.org.id).worksiteId, seeded.get(b.org.id).worksiteId));
    assert.ok(seeded.get(victim.org.id).jobProfileId >
      Math.max(seeded.get(a.org.id).jobProfileId, seeded.get(b.org.id).jobProfileId));

    const tableNames = [
      "worksites", "jobProfiles", "workforceDemandStaffingPolicies",
      "workforceDemandStaffingPolicyEvents", "auditEvents", "employees",
      "employeePayProfiles", "userOrganizations", "payrollRuns",
      "employeeScheduleAssignments", "workforcePlanningScenarios",
    ];
    const snapshot = async orgId => {
      const data = {
        organizations: await db.select().from(schema.organizations)
          .where(eq(schema.organizations.id, orgId)),
      };
      for (const name of tableNames) {
        const table = schema[name];
        assert.ok(table?.id && table.organizationId, "missing snapshot source: " + name);
        data[name] = await db.select().from(table)
          .where(eq(table.organizationId, orgId)).orderBy(asc(table.id));
      }
      return plain(data);
    };
    const subjects = [a, b, victim, excluded];
    const before = new Map(await Promise.all(
      subjects.map(async e => [e.org.id, await snapshot(e.org.id)])));
    const unchanged = async label => {
      for (const e of subjects) {
        assert.deepEqual(await snapshot(e.org.id), before.get(e.org.id),
          label + ": employee, policy, audit and payroll sources must remain unchanged (" +
          e.marker + ")");
      }
    };
    const denied = async (url, cookie, status, label, forbidden) => {
      const res = await request(url, { cookie });
      assertApprovedPolicyDenial(res, status, forbidden);
      await unchanged(label);
    };
    const first = new Map();
    const counts = {
      ownApproved200: 0, independentCheckerReceipts: 3,
      foreignEmployer403: 0, stolenWorksite403: 0,
      victimRole403: 0, forgedPolicyIdOwnOnly: 0,
      crossEmployerProofRejected: 0, anonymous401: 0,
      excluded404: 0, invalidScope400: 0, victimOwn200: 0,
    };
    for (const attacker of [a, b]) {
      const expected = seeded.get(attacker.org.id);
      const victimRow = seeded.get(victim.org.id);
      const url = endpoint(attacker.org.id, expected.worksiteId, expected.jobProfileId);
      const own = await request(url, { cookie: attacker.cookie });
      assertApprovedPolicyHttp(own, expected, [victim.marker,
        attacker === a ? b.marker : a.marker]);
      counts.ownApproved200++;
      if (first.has("own")) {
        assert.throws(() => assertApprovedPolicyHttp(first.get("own"), expected),
          "one employer's successful response cannot prove another employer's data");
        counts.crossEmployerProofRejected++;
      } else first.set("own", own);

      await denied(endpoint(victim.org.id, victimRow.worksiteId, victimRow.jobProfileId),
        attacker.cookie, 403, "real allowlisted victim employer", [victim.marker]);
      counts.foreignEmployer403++;
      await denied(endpoint(attacker.org.id, victimRow.worksiteId, expected.jobProfileId),
        attacker.cookie, 403, "genuine foreign higher-ID worksite", [victim.marker]);
      counts.stolenWorksite403++;
      await denied(endpoint(attacker.org.id, expected.worksiteId, victimRow.jobProfileId),
        attacker.cookie, 403, "genuine foreign higher-ID job profile", [victim.marker]);
      counts.victimRole403++;
      // A forged victim-only policy ID is not a supported GET selector. It must
      // be ignored without changing the exact own SQL-bound response.
      const forged = await request(url + "&policyId=" + victimRow.id,
        { cookie: attacker.cookie });
      assertApprovedPolicyHttp(forged, expected, [victim.marker]);
      counts.forgedPolicyIdOwnOnly++;
      await denied(url, undefined, 401, "anonymous own employer", [victim.marker]);
      counts.anonymous401++;
      await denied(endpoint(excluded.org.id, victimRow.worksiteId, victimRow.jobProfileId),
        excluded.cookie, 404, "disabled fourth employer", [victim.marker]);
      counts.excluded404++;
      await denied(endpoint(attacker.org.id, "invalid", expected.jobProfileId),
        attacker.cookie, 400, "malformed own worksite", [victim.marker]);
      counts.invalidScope400++;
    }
    const victimExpected = seeded.get(victim.org.id);
    const victimOwn = await request(endpoint(victim.org.id,
      victimExpected.worksiteId, victimExpected.jobProfileId),
      { cookie: victim.cookie });
    assertApprovedPolicyHttp(victimOwn, victimExpected, [a.marker, b.marker]);
    counts.victimOwn200++;
    await unchanged("all own 200, real victim, foreign, forged and denied GETs");
    console.log(JSON.stringify({
      kind: "tenant-approved-staffing-policy-get-proof",
      method: APPROVED_POLICY_GET, ...counts,
      sourceOwned: true, approvedReceiptIntegrity: "matches_hash",
      realPostgreSQL16: true, actualLocalhostHTTP: true,
      allSourceAndPayrollTablesUnchanged: true,
      providerCalls: 0, payrollActions: 0, rosterWrites: 0,
      coverageCredits: 0, productionTested: false, independentlyAccepted: false,
    }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/")
  .endsWith("/tenant-demand-approved-policy-get-http.mjs")) {
  verifyApprovedStaffingPolicyGet().then(() => process.exit(0), error => {
    console.error(error instanceof Error ? error.message : "approved-policy GET failed");
    process.exit(1);
  });
}
