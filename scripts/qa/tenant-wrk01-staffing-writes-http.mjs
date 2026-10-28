/**
 * WRK-01 policy POST/PATCH: real production-mode localhost HTTP backed by
 * a freshly bootstrapped, fictional PostgreSQL 16 database.
 * The run never creates shifts, time entries, pay, or provider transactions.
 * ZERO manifest credits: independent review and whole-batch reconciliation remain.
 */
import assert from "node:assert/strict";
import {
  STAFFING_ENDPOINT, requireDisposableStaffingWrites, assertStaffingDenied,
  assertStaffingWrite, assertImmutableStaffingSql, assertNoForeignPolicy,
} from "./tenant-wrk01-staffing-writes-contract.mjs";
import { assertNonCacheableDemand } from "./tenant-demand-governance-recovery-contract.mjs";

function addDays(date, offset) {
  const x = new Date(date + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + offset);
  return x.toISOString().slice(0, 10);
}
const plain = value => JSON.parse(JSON.stringify(value));

export async function proveStaffingWrites() {
  // Mandatory fail-closed validation precedes every database / application import.
  requireDisposableStaffingWrites();
  const [database, s, drizzle, helpers, guards, calendar] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
    import("./tenant-table-invariants.mjs"),
    import("../../src/lib/workforce-employee-upcoming-week.ts"),
  ]);
  const { db, pool } = database;
  const { and, asc, eq } = drizzle;
  const request = helpers.standaloneRequest;
  const [victim, a, b] = guards.readAllowlistPreseed(
    process.env.TENANT_TABLE_ALLOWLIST_FIXTURE);
  const excluded = guards.readPrivateAllowlistFixture(
    process.env.TENANT_TABLE_ALLOWLIST_FIXTURE).excluded;
  const subjects = [a, b, victim, excluded];
  const tomorrow = calendar.manilaWorkDate();
  const scopeTables = [
    "organizations", "employees", "employeePayProfiles", "worksites",
    "jobProfiles", "userOrganizations", "workforceDemandStaffingPolicies",
    "workforceDemandStaffingPolicyEvents", "workforceDemandForecastIssues",
    "workforceDemandForecastScores", "payrollRuns", "timePunches",
    "employeeScheduleAssignments", "scheduleOverrides", "auditEvents",
  ];
  async function snapshot(orgId) {
    const result = {};
    for (const name of scopeTables) {
      const table = s[name];
      assert.ok(table?.id, "required disposable SQL table missing: " + name);
      const where = name === "organizations"
        ? eq(table.id, orgId)
        : eq(table.organizationId, orgId);
      const rows = await db.select().from(table).where(where).orderBy(asc(table.id));
      result[name] = name === "auditEvents" ? guards.auditBusinessSnapshot(rows) : rows;
    }
    result.payrollEntries = await db.select().from(s.payrollEntries)
      .innerJoin(s.payrollRuns, eq(s.payrollEntries.payrollRunId, s.payrollRuns.id))
      .where(eq(s.payrollRuns.organizationId, orgId))
      .orderBy(asc(s.payrollEntries.id));
    return plain(result);
  }
  async function freezeAll() {
    return new Map(await Promise.all(subjects.map(async e =>
      [e.org.id, await snapshot(e.org.id)])));
  }
  async function unchangedEverywhere(before, context) {
    for (const e of subjects) {
      assertImmutableStaffingSql(before.get(e.org.id), await snapshot(e.org.id),
        context + " " + e.marker);
    }
  }
  async function denied(method, body, cookie, status, context) {
    const before = await freezeAll();
    const response = await request(STAFFING_ENDPOINT, { method, body, cookie });
    assertStaffingDenied(response, status, subjects.map(e => e.marker));
    await unchangedEverywhere(before, context);
  }
  function bodyFor(e, variation) {
    return {
      organizationId: e.org.id,
      worksiteId: e.site.id,
      jobProfileId: e.job.id,
      metricKind: "transactions", intervalMinutes: 60,
      effectiveFrom: addDays(tomorrow, 14),
      effectiveUntil: addDays(tomorrow, 44),
      productiveUnitsPerWorkerHour: 10 + Number(e.rank ?? 1) +
        (variation === "approve" ? 0 : 0.5),
      serviceTargetCoveragePercent: 84,
      rationale: e.marker + " fictional " + variation +
        " planning-only staffing policy, not shifts or payroll",
      // Shared across all employers: idempotency must be organization-scoped.
      idempotencyKey: variation === "approve"
        ? "ci-shared-staffing-approve-202610"
        : "ci-shared-staffing-reject-202610",
    };
  }
  function transition(e, policyId, action) {
    return {
      organizationId: e.org.id, policyId, action,
      decisionNote: e.marker + " fictional independent " + action +
        " decision for disposable policy",
      acknowledged: true,
    };
  }
  async function seedEmployerEvidence(e) {
    const [site] = await db.insert(s.worksites).values({
      organizationId: e.org.id, orgUnitId: e.unit.id,
      code: (e.marker + "-WSP").slice(0, 32),
      name: e.marker + " fictional workforce policy site",
      timezone: "Asia/Manila", active: true,
    }).returning();
    const [job] = await db.insert(s.jobProfiles).values({
      organizationId: e.org.id,
      title: e.marker + " fictional staffing-only job",
      family: "General", level: "Individual Contributor", active: true,
    }).returning();
    const [checker] = await db.insert(s.users).values({
      email: e.marker.toLowerCase() + "-policy-checker@example.invalid",
      name: e.marker + " independent policy checker",
      role: "admin", totpEnabled: true,
      passwordHash: "fictional-session-only-no-login",
    }).returning();
    await db.insert(s.userOrganizations).values({
      userId: checker.id, organizationId: e.org.id,
      role: "admin", active: true, orgUnitId: null,
    });
    const session = await helpers.standaloneMakeSession(checker.id);
    await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
      .where(eq(s.sessions.id, session.id));
    e.site = site;
    e.job = job;
    e.checker = { id: checker.id, cookie: session.cookie };
    assert.notEqual(e.cookie, e.checker.cookie);
  }
  async function positive(e, method, body, policyStatus, actorId, cookie) {
    // Snapshot every real employer, not just the actor. A 201 on Alpha is NOT
    // proof of isolation if it silently writes Beta, the victim or excluded.
    const allBefore = await freezeAll();
    const before = allBefore.get(e.org.id);
    const response = await request(STAFFING_ENDPOINT, { method, body, cookie });
    const expectedStatus = method === "POST" ? 201 : 200;
    assert.equal(response.status, expectedStatus,
      e.marker + " " + method + " " + policyStatus + ": " +
      response.status + " " + response.text.slice(0, 200));
    const after = await snapshot(e.org.id);
    const row = after.workforceDemandStaffingPolicies.find(
      candidate => candidate.id === response.json?.id);
    assert.ok(row, "HTTP success must reference a real own SQL row");
    assert.equal(row.organizationId, e.org.id);
    assert.equal(row.worksiteId, e.site.id);
    assert.equal(row.jobProfileId, e.job.id);
    assert.equal(row.status, policyStatus);
    assert.equal(row.rationale, body.rationale ?? row.rationale);
    if (method === "POST") assert.equal(row.idempotencyKey, body.idempotencyKey);
    assertStaffingWrite(response, row, {
      status: expectedStatus, policyStatus,
      kind: method, actorId, foreignMarkers: subjects.filter(x => x !== e)
        .map(x => x.marker),
    });
    const action = method === "POST"
      ? "created"
      : ({ submit: "submitted", approve: "approved", reject: "rejected" })[body.action];
    assert.equal(after.workforceDemandStaffingPolicyEvents.length,
      before.workforceDemandStaffingPolicyEvents.length + 1);
    assert.equal(after.auditEvents.length, before.auditEvents.length + 1);
    const event = after.workforceDemandStaffingPolicyEvents.find(
      x => x.policyId === row.id && x.action === action &&
        x.actorUserId === actorId);
    assert.ok(event && event.id, "exact actor/target audit event must persist");
    assert.equal(event.organizationId, e.org.id);
    assert.equal(event.policySha256, row.contentSha256);
    assert.match(event.receiptSha256, /^[a-f0-9]{64}$/);
    const audit = after.auditEvents.find(x =>
      x.action === "WFM staffing policy " + action &&
      x.resource === "staffing-policy:" + row.id);
    assert.ok(audit, "exact employer/target audit must persist");
    assert.equal(audit.organizationId, e.org.id);
    assert.equal(audit.actor, "WFM administrator user:" + actorId);
    assert.equal(audit.metadata.receiptSha256, event.receiptSha256);
    for (const key of Object.keys(before).filter(name => ![
      "workforceDemandStaffingPolicies",
      "workforceDemandStaffingPolicyEvents", "auditEvents",
    ].includes(name))) {
      assert.deepEqual(after[key], before[key],
        "staffing " + action + " must never mutate " + key);
    }
    for (const other of subjects.filter(x => x !== e)) {
      assert.ok(!response.text.includes(other.marker),
        "a success must not include another employer's private policy");
      assertImmutableStaffingSql(allBefore.get(other.org.id),
        await snapshot(other.org.id),
        "successful " + method + " " + policyStatus +
        " must leave foreign/victim/excluded employer unchanged: " + other.marker);
    }
    return { row, response };
  }
  async function ownRead(e, expectedStatus, expectedIds) {
    const before = await freezeAll();
    const params = new URLSearchParams({
      organizationId: String(e.org.id), worksiteId: String(e.site.id),
      jobProfileId: String(e.job.id),
      metricKind: "transactions", intervalMinutes: "60", mode: "manage",
    });
    const response = await request(STAFFING_ENDPOINT + "?" + params, {
      cookie: e.cookie,
    });
    assert.equal(response.status, 200, "populated own policy GET must work");
    assertNonCacheableDemand(response.headers);
    assert.equal(response.json?.readOnly, true);
    assert.equal(response.json.scope.organizationId, e.org.id);
    assert.equal(response.json.scope.worksiteId, e.site.id);
    const selected = response.json.policies.filter(p =>
      expectedIds.includes(p.id) && p.status === expectedStatus);
    assert.equal(selected.length, expectedIds.length,
      "own GET must reflect committed policy status and genuine IDs");
    for (const row of selected) {
      assert.ok(row.rationale.includes(e.marker));
      assert.equal(row.approvalIntegrity, "matches_hash");
    }
    assertNoForeignPolicy(response, subjects.filter(x => x !== e)
      .map(x => x.marker));
    await unchangedEverywhere(before, "own policy GET cannot mutate any business source");
  }
  try {
    const version = await pool.query("show server_version_num");
    assert.equal(Math.floor(Number(version.rows[0]?.server_version_num) / 10000), 16);
    assert.equal((await db.select({ id: s.workforceDemandStaffingPolicies.id })
      .from(s.workforceDemandStaffingPolicies).limit(1)).length, 0,
      "only an unmodified disposable policy store may be used");
    for (const e of subjects) {
      assert.ok(e.org.id > 0);
      assert.ok(e.cookie?.startsWith("__Host-linaw_session="));
    }
    for (const e of [a, b, victim]) await seedEmployerEvidence(e);
    assert.ok(victim.site.id > a.site.id && victim.site.id > b.site.id);
    assert.ok(victim.job.id > a.job.id && victim.job.id > b.job.id);
    assert.ok(victim.worker.id > a.worker.id && victim.worker.id > b.worker.id);
    assert.notEqual(a.cookie, b.cookie);
    assert.notEqual(a.checker.cookie, b.checker.cookie);

    // Two independently authenticated attackers create their own real drafts.
    // A third real victim owner positively creates a higher-ID victim target.
    for (const e of [a, b, victim]) {
      e.approveBody = bodyFor(e, "approve");
      e.rejectBody = bodyFor(e, "reject");
      e.approve = await positive(e, "POST", e.approveBody, "draft",
        e.owner.id, e.cookie);
      const beforeReplay = await freezeAll();
      const replay = await request(STAFFING_ENDPOINT, {
        method: "POST", cookie: e.cookie, body: e.approveBody,
      });
      assertStaffingWrite(replay, e.approve.row, {
        status: 200, policyStatus: "draft", kind: "POST",
        replayed: true, actorId: e.owner.id,
        foreignMarkers: subjects.filter(x => x !== e).map(x => x.marker),
      });
      await unchangedEverywhere(beforeReplay, "idempotent employer-specific POST");
      e.reject = await positive(e, "POST", e.rejectBody, "draft",
        e.owner.id, e.cookie);
      assert.ok(e.reject.row.id > e.approve.row.id);
      assert.notEqual(e.approve.row.contentSha256, e.reject.row.contentSha256);
      await ownRead(e, "draft", [e.approve.row.id, e.reject.row.id]);
    }
    assert.ok(victim.approve.row.id > a.reject.row.id &&
      victim.approve.row.id > b.reject.row.id,
    "genuine victim policy target must exceed both attacker policy IDs");

    for (const actor of [a, b]) {
      const other = actor === a ? b : a;
      const foreign = {
        ...actor.approveBody, organizationId: victim.org.id,
        worksiteId: victim.site.id, jobProfileId: victim.job.id,
      };
      await denied("POST", foreign, actor.cookie, 403,
        "foreign organization POST");
      await denied("POST", {
        ...actor.approveBody, worksiteId: victim.site.id,
        idempotencyKey: "ci-forged-worksite-tenant-0001",
      }, actor.cookie, 403, "stolen higher-ID worksite POST");
      await denied("POST", {
        ...actor.approveBody, jobProfileId: victim.job.id,
        idempotencyKey: "ci-forged-jobprofile-tenant-001",
      }, actor.cookie, 403, "stolen higher-ID job profile POST");
      await denied("POST", {
        ...actor.approveBody, idempotencyKey: "ci-forged-selector-policy-0001",
        employeeId: victim.worker.id,
      }, actor.cookie, 400, "extra forged employee selector POST");
      await denied("POST", {
        ...actor.approveBody, idempotencyKey: "ci-forged-actor-policy-00001",
        actorUserId: victim.owner.id,
      }, actor.cookie, 400, "extra forged actor selector POST");
      await denied("PATCH", {
        ...transition(victim, victim.approve.row.id, "submit"),
      }, actor.cookie, 403, "foreign organization PATCH");
      await denied("PATCH", {
        ...transition(actor, victim.approve.row.id, "submit"),
      }, actor.cookie, 409, "stolen real higher-ID victim policy PATCH");
      await denied("PATCH", {
        ...transition(actor, actor.approve.row.id, "submit"),
        policyOwnerId: victim.owner.id,
      }, actor.cookie, 400, "extra forged policy owner PATCH");
      await denied("PATCH", transition(actor, actor.approve.row.id, "approve"),
        actor.cookie, 403, "owner cannot approve a draft");
      await denied("PATCH", transition(actor, actor.approve.row.id, "approve"),
        other.checker.cookie, 403, "foreign organization cannot approve");
    }
    await denied("POST", a.approveBody, undefined, 401, "anonymous POST");
    await denied("PATCH", transition(a, a.approve.row.id, "submit"),
      undefined, 401, "anonymous PATCH");

    // The author must submit; only a different, real MFA-verified
    // owner/admin from the same employer may decide. Exercise every PATCH action.
    for (const e of [a, b, victim]) {
      const submitted = await positive(e, "PATCH",
        transition(e, e.approve.row.id, "submit"),
        "submitted", e.owner.id, e.cookie);
      await denied("PATCH", transition(e, submitted.row.id, "approve"),
        e.cookie, 403, "self-approval of submitted policy must fail");
      const approved = await positive(e, "PATCH",
        transition(e, submitted.row.id, "approve"),
        "approved", e.checker.id, e.checker.cookie);
      assert.equal(approved.row.approvalReceiptSha256 ?? undefined, undefined,
        "approval receipt belongs to signed decision event, not mutable policy row");
      const approvedView = await request(STAFFING_ENDPOINT + "?" +
        new URLSearchParams({
          organizationId: String(e.org.id), worksiteId: String(e.site.id),
          jobProfileId: String(e.job.id), metricKind: "transactions",
          intervalMinutes: "60", mode: "approved",
        }), { cookie: e.cookie });
      assert.equal(approvedView.status, 200);
      assertNonCacheableDemand(approvedView.headers);
      const approvedRows = approvedView.json?.policies ?? [];
      const real = approvedRows.find(p => p.id === approved.row.id);
      assert.ok(real, "approved own policy must be visible in approved-only GET");
      assert.equal(real.status, "approved");
      assert.equal(real.approvalIntegrity, "matches_hash");
      assert.equal(real.approvalReceiptSha256, approved.response.json.approvalReceiptSha256);
      assertNoForeignPolicy(approvedView, subjects.filter(x => x !== e)
        .map(x => x.marker));

      const submittedReject = await positive(e, "PATCH",
        transition(e, e.reject.row.id, "submit"),
        "submitted", e.owner.id, e.cookie);
      const rejected = await positive(e, "PATCH",
        transition(e, submittedReject.row.id, "reject"),
        "rejected", e.checker.id, e.checker.cookie);
      assert.equal(rejected.row.status, "rejected");
      await ownRead(e, "rejected", [e.reject.row.id]);
    }

    // Prove that revocation in Alpha blocks the original session despite an
    // independently valid, second company membership. Never mutate Beta.
    await db.insert(s.userOrganizations).values({
      userId: a.owner.id, organizationId: b.org.id,
      role: "owner", orgUnitId: null, active: true,
    });
    const [alphaMembership] = await db.select().from(s.userOrganizations)
      .where(and(eq(s.userOrganizations.organizationId, a.org.id),
        eq(s.userOrganizations.userId, a.owner.id),
        eq(s.userOrganizations.active, true))).limit(1);
    assert.ok(alphaMembership?.id);
    await db.update(s.userOrganizations).set({ active: false })
      .where(eq(s.userOrganizations.id, alphaMembership.id));
    const beforeRevokeDenials = await freezeAll();
    await denied("POST", {
      ...a.approveBody, idempotencyKey: "ci-after-revoke-tenant-test-01",
    }, a.cookie, 403, "revoked Alpha POST");
    await denied("PATCH", transition(a, a.approve.row.id, "submit"),
      a.cookie, 403, "revoked Alpha PATCH");
    await unchangedEverywhere(beforeRevokeDenials,
      "revoked Alpha author cannot modify any organization");
    assert.ok((await request(STAFFING_ENDPOINT + "?" +
      new URLSearchParams({
        organizationId: String(b.org.id), worksiteId: String(b.site.id),
        jobProfileId: String(b.job.id), metricKind: "transactions",
        intervalMinutes: "60", mode: "manage",
      }), { cookie: a.cookie })).status === 200,
    "same original Alpha session must remain alive for its active Beta membership");
    assert.ok((await request(STAFFING_ENDPOINT + "?" +
      new URLSearchParams({
        organizationId: String(b.org.id), worksiteId: String(b.site.id),
        jobProfileId: String(b.job.id), metricKind: "transactions",
        intervalMinutes: "60", mode: "manage",
      }), { cookie: b.cookie })).status === 200,
    "Beta owner must retain legitimate access");
    console.log("FICTIONAL_WRK01_STAFFING_POLICY_WRITES_PASS: two independent attackers + " +
      "real higher-ID victim; POST create/replay; PATCH submit/approve/reject; " +
      "real event+audit receipts; forged scope, role, idempotency and revocation denials; " +
      "victim, workers and payroll untouched on denied requests; ZERO NEW METHOD CREDITS");
  } finally {
    await pool.end();
  }
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith(
  "scripts/qa/tenant-wrk01-staffing-writes-http.mjs")) {
  proveStaffingWrites().catch(error => {
    console.error("FICTIONAL_WRK01_STAFFING_POLICY_WRITES_FAIL:", error.message);
    process.exitCode = 1;
  });
}
