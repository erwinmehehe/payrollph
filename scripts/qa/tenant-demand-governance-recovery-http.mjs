/**
 * Additional missing four-part evidence for the two existing Workforce
 * Demand Governance GET GAPs. Reuses the reviewed #1474 row fixtures,
 * dynamic allowlists and two independent signed-in fictional owners.
 *
 * No provider, forecast issuing endpoint, policy approval, roster mutation,
 * payroll calculation or production database is touched.
 */
import assert from "node:assert/strict";
import {
  DEMAND_RECOVERY_METHODS, requireDisposableDemandRecovery,
  assertDemandDenial, assertBoundDemandRead, assertImmutableDemandSources,
} from "./tenant-demand-governance-recovery-contract.mjs";
import {
  createRows, fixtureDemandSha256,
} from "./tenant-table-rows/read/demand-governance.mjs";

const plain = value => JSON.parse(JSON.stringify(value));

export async function verifyDemandGovernanceGapRecovery() {
  // Do not import any database or app module before this exact CI-only guard.
  requireDisposableDemandRecovery();
  const [database, schema, drizzle, helpers, invariants] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
    import("./tenant-table-invariants.mjs"),
  ]);
  const { db, pool } = database;
  const { asc, eq, and } = drizzle;
  const { standaloneRequest: request } = helpers;
  try {
    const serverVersion = await pool.query("SHOW server_version_num");
    assert.equal(Math.floor(Number(serverVersion.rows[0]?.server_version_num) / 10000), 16,
      "DEMAND_RECOVERY_REFUSED: actual disposable PostgreSQL 16 required");
    const [victim, a, b] = invariants.readAllowlistPreseed(
      process.env.TENANT_TABLE_ALLOWLIST_FIXTURE);
    const fixture = invariants.readPrivateAllowlistFixture(
      process.env.TENANT_TABLE_ALLOWLIST_FIXTURE);
    const excluded = fixture.excluded;
    for (const employer of [a, b, victim, excluded]) {
      assert.ok(Number.isSafeInteger(employer.org.id) && employer.org.id > 0);
      assert.match(employer.cookie, /^__Host-linaw_session=[a-f0-9]{64}$/);
    }
    assert.ok(victim.org.id > a.org.id && victim.org.id > b.org.id);
    assert.ok(excluded.org.id > victim.org.id);

    // Reuse the exact, independently reviewed source row fixtures. Do not
    // edit them or pretend this script can manufacture an old source receipt.
    const rows = createRows({ assert, db, rowTables: schema });
    assert.deepEqual(rows.map(row => row.key), DEMAND_RECOVERY_METHODS);
    for (const row of rows) {
      for (const employer of [a, b, victim]) {
        employer.seeded[row.key] = await row.seed(employer);
      }
      assert.ok(victim.seeded[row.key].id >
        Math.max(a.seeded[row.key].id, b.seeded[row.key].id),
      row.key + ": victim source row must have a real higher SQL ID");
      assert.ok(victim.seeded[row.key].siteId >
        Math.max(a.seeded[row.key].siteId, b.seeded[row.key].siteId),
      row.key + ": victim worksite must have a real higher SQL ID");
    }

    // Additional role-selector source: a valid own-role policy and a genuine
    // foreign higher-ID role. This tests the GET jobProfileId scope branch;
    // neither policy is approved or used for scheduling.
    const rolePolicies = new Map();
    for (const employer of [a, b, victim]) {
      const [role] = await db.insert(schema.jobProfiles).values({
        organizationId: employer.org.id,
        title: employer.marker + " fictional demand-only job role",
        family: "General", level: "Individual Contributor", active: true,
      }).returning();
      assert.equal(role.organizationId, employer.org.id);
      const base = employer.seeded["GET workforce/demand-staffing/policies"];
      const spec = {
        ...base.spec, jobProfileId: role.id,
        rationale: employer.marker + " role-specific fictional draft only",
      };
      const contentSha = fixtureDemandSha256({ version: 1, spec });
      const [policy] = await db.insert(schema.workforceDemandStaffingPolicies)
        .values({
          ...spec, version: 1,
          productiveUnitsPerWorkerHour: spec.productiveUnitsPerWorkerHour.toFixed(4),
          serviceTargetCoveragePercent: spec.serviceTargetCoveragePercent.toFixed(2),
          idempotencyKey: employer.marker + "-role-policy",
          contentSha256: contentSha, status: "draft",
          proposedByUserId: employer.owner.id,
        }).returning();
      assert.equal(policy.organizationId, employer.org.id);
      assert.equal(policy.jobProfileId, role.id);
      rolePolicies.set(employer.org.id, { role, policy });
    }
    assert.ok(rolePolicies.get(victim.org.id).role.id >
      Math.max(rolePolicies.get(a.org.id).role.id, rolePolicies.get(b.org.id).role.id));

    const sourceTables = [
      "worksites", "jobProfiles", "workforceDemandForecastIssues",
      "workforceDemandForecastScores", "workforceDemandObservationRevisions",
      "workforceDemandStaffingPolicies", "workforceDemandStaffingPolicyEvents",
      "employees", "employeePayProfiles", "orgUnits", "userOrganizations",
      "auditEvents", "payrollRuns", "employeeScheduleAssignments",
      "workforcePlanningScenarios", "shiftDefinitions",
    ];
    const snapshot = async orgId => {
      const result = {};
      result.organizations = await db.select().from(schema.organizations)
        .where(eq(schema.organizations.id, orgId));
      for (const name of sourceTables) {
        const table = schema[name];
        assert.ok(table?.id && table.organizationId, "SQL source missing: " + name);
        result[name] = await db.select().from(table)
          .where(eq(table.organizationId, orgId)).orderBy(asc(table.id));
      }
      result.payrollEntries = await db.select({ entry: schema.payrollEntries })
        .from(schema.payrollEntries)
        .innerJoin(schema.payrollRuns,
          eq(schema.payrollEntries.payrollRunId, schema.payrollRuns.id))
        .where(eq(schema.payrollRuns.organizationId, orgId))
        .orderBy(asc(schema.payrollEntries.id));
      return plain(result);
    };
    const subjects = [a, b, victim, excluded];
    const before = new Map(await Promise.all(subjects.map(async e =>
      [e.org.id, await snapshot(e.org.id)])));
    const ensureUnchanged = async label => {
      for (const subject of subjects) {
        assertImmutableDemandSources(before.get(subject.org.id),
          await snapshot(subject.org.id), label + " " + subject.label);
      }
    };
    const denied = async (url, cookie, code, label, markers) => {
      const response = await request(url, { cookie });
      assertDemandDenial(response, code, markers);
      await ensureUnchanged(label);
    };
    const endpoint = (row, orgId, extra) =>
      "/api/" + row.key.split(" ").slice(1).join(" ") +
      "?organizationId=" + orgId + "&" + extra;
    const counts = {
      ownerOwnReads: 0, victimOwnControls: 0,
      foreignTenant403: 0, stolenWorksite403: 0,
      crossEmployerDiscrimination: 0, forgedSelectorsDenied: 0,
      roleSpecificPositive: 0, anonymousDenied: 0, excludedEmployer404: 0,
      invalidScope400: 0, approvedModeExcludesDrafts: 0,
    };
    for (const [i, row] of rows.entries()) {
      const kind = i === 0 ? "issued" : "policy";
      const firstResponse = new Map();
      for (const [attackerIndex, attacker] of [a, b].entries()) {
        const c = {
          orgId: attacker.org.id, seeded: attacker.seeded[row.key],
          victimSeeded: victim.seeded[row.key], marker: attacker.marker,
          rank: attacker.rank, victim, owner: attacker.owner,
          forbiddenMarkers: [attacker === a ? b.marker : a.marker],
        };
        const url = endpoint(row, c.orgId, row.query(c));
        const own = await request(url, { cookie: attacker.cookie });
        assert.equal(own.status, 200, row.key + ": authorized own GET");
        row.prove(own, c);
        const rowsInSql = kind === "issued"
          ? before.get(c.orgId).workforceDemandForecastIssues
          : before.get(c.orgId).workforceDemandStaffingPolicies;
        const saved = rowsInSql.find(record => record.id === c.seeded.id);
        assertBoundDemandRead(kind, own, c, saved);
        counts.ownerOwnReads++;
        if (attackerIndex === 0) firstResponse.set(row.key, own);
        else {
          await assert.rejects(async () => row.prove(firstResponse.get(row.key), c),
            row.key + ": employer A's genuine SQL/HTTP cannot prove employer B");
          counts.crossEmployerDiscrimination++;
        }

        // The feature flag explicitly allows victim's real employer. A 403
        // here must come from authorization, never a disabled-feature 404.
        await denied(endpoint(row, victim.org.id, row.foreignQuery(c)),
          attacker.cookie, 403, row.key + " cross-company",
          [victim.marker, c.marker]);
        counts.foreignTenant403++;

        // Actual higher-ID foreign worksite with the attacker's own valid
        // organization is a 403; it must not serve any stored victim source.
        await denied(endpoint(row, c.orgId, row.foreignQuery(c)),
          attacker.cookie, 403, row.key + " stolen-worksite",
          [victim.marker, c.marker]);
        counts.stolenWorksite403++;

        // A forged source ID/marker on a valid own site cannot re-scope the
        // response. Both endpoints must still return only the SQL-bound own row.
        const forgedParam = kind === "issued"
          ? "&issueId=" + c.victimSeeded.id + "&sourceKey=" +
              encodeURIComponent(c.victimSeeded.sourceKey)
          : "&policyId=" + c.victimSeeded.id;
        const forged = await request(url + forgedParam, { cookie: attacker.cookie });
        row.prove(forged, c);
        assertBoundDemandRead(kind, forged, c, saved);
        counts.forgedSelectorsDenied++;

        // Only the real signed-in owner may read this employer. An anonymous
        // request for the valid allowlisted employer must be 401, not 404.
        await denied(url, undefined, 401, row.key + " anonymous",
          [victim.marker, c.marker]);
        counts.anonymousDenied++;
      }

      const victimC = { orgId: victim.org.id, seeded: victim.seeded[row.key],
        victim: { marker: a.marker }, forbiddenMarkers: [b.marker] };
      const victimUrl = endpoint(row, victim.org.id, row.query(victimC));
      const ownVictim = await request(victimUrl, { cookie: victim.cookie });
      row.prove(ownVictim, victimC);
      const victimSql = kind === "issued"
        ? before.get(victim.org.id).workforceDemandForecastIssues
        : before.get(victim.org.id).workforceDemandStaffingPolicies;
      assertBoundDemandRead(kind, ownVictim, victimC,
        victimSql.find(x => x.id === victimC.seeded.id));
      counts.victimOwnControls++;

      const notAllowedUrl = endpoint(row, excluded.org.id,
        kind === "issued" ? "worksiteId=1" :
          "worksiteId=1&jobProfileId=any&metricKind=transactions&intervalMinutes=60&mode=manage");
      await denied(notAllowedUrl, excluded.cookie, 404,
        row.key + " nonallowlisted fourth employer",
        [a.marker, b.marker, victim.marker, excluded.marker]);
      counts.excludedEmployer404++;

      const malformed = endpoint(row, a.org.id, "worksiteId=not-a-number");
      await denied(malformed, a.cookie, 400, row.key + " invalid worksite",
        [victim.marker]);
      counts.invalidScope400++;
    }

    const policyRow = rows[1];
    for (const attacker of [a, b]) {
      const c = { orgId: attacker.org.id, seeded: attacker.seeded[policyRow.key],
        victimSeeded: victim.seeded[policyRow.key], victim };
      const ownRole = rolePolicies.get(attacker.org.id);
      const victimRole = rolePolicies.get(victim.org.id);
      const base = "/api/workforce/demand-staffing/policies?organizationId=" +
        c.orgId + "&worksiteId=" + c.seeded.siteId +
        "&metricKind=transactions&intervalMinutes=60";
      const roleGet = await request(base + "&jobProfileId=" +
        ownRole.role.id + "&mode=manage", { cookie: attacker.cookie });
      assert.equal(roleGet.status, 200);
      assert.equal(roleGet.json?.readOnly, true);
      assert.equal(roleGet.json?.policies?.length, 1);
      const own = roleGet.json.policies[0];
      assert.equal(own.id, ownRole.policy.id);
      assert.equal(own.jobProfileId, ownRole.role.id);
      assert.equal(own.organizationId, c.orgId);
      assert.equal(own.contentSha256, ownRole.policy.contentSha256);
      assert.equal(own.approvalIntegrity, "matches_hash");
      assert.equal(own.status, "draft");
      assert.ok(!roleGet.text.includes(victim.marker));
      counts.roleSpecificPositive++;

      await denied(base + "&jobProfileId=" + victimRole.role.id +
        "&mode=manage", attacker.cookie, 403,
        "genuine victim higher-ID job-profile selector", [victim.marker]);
      counts.forgedSelectorsDenied++;

      // The default approved-mode GET is positive HTTP 200 yet MUST NOT
      // reinterpret an unapproved draft as a live approved policy.
      const approvedGet = await request(base + "&jobProfileId=any&mode=approved",
        { cookie: attacker.cookie });
      assert.equal(approvedGet.status, 200);
      assert.deepEqual(approvedGet.json?.policies, [],
        "draft policy must never appear in independently approved view");
      assert.ok(!approvedGet.text.includes(victim.marker));
      counts.approvedModeExcludesDrafts++;
    }
    await ensureUnchanged("all own, victim, foreign, forged and negative GETs");
    console.log(JSON.stringify({
      kind: "tenant-demand-governance-gap-recovery-proof",
      methods: DEMAND_RECOVERY_METHODS,
      ...counts, genuineHigherIdVictim: true,
      ownedSourceRowsAndHashesBoundToHttp: true,
      snapshotSourceTables: sourceTables.length + 2,
      allEmployersAndAuditUnchanged: true, productionTested: false,
      certified: false, coverageCredits: 0,
      approvedPolicyCreated: false, externalProviderCalled: false,
    }));
    return { methods: DEMAND_RECOVERY_METHODS.length, credited: 0 };
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/")
  .endsWith("/tenant-demand-governance-recovery-http.mjs")) {
  verifyDemandGovernanceGapRecovery().then(() => process.exit(0), error => {
    console.error(error instanceof Error ? error.message : "demand recovery failed");
    process.exit(1);
  });
}
