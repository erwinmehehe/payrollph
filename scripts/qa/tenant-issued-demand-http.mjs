/**
 * Two POST methods: issued aggregate forecasts and one-time final scores.
 * Exactly two independent authenticated attackers, a higher-ID real victim,
 * and one non-allowlisted fictional employer. Production-mode localhost
 * Next / disposable PG16 ONLY. No provider, payroll, roster or real account.
 *
 * All direct SQL inserts below are explicitly synthetic source fixtures.
 * Positive issuance and scoring are real HTTP calls to production handlers.
 * Historical score fixture is NOT a claim of an actual 25-day CI wait.
 * Evidence candidate only: manifest credits remain zero until review.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  ISSUE_PATH, SCORE_PATH, ISSUED_DEMAND_POST_METHODS,
  requireDisposableIssuedDemand, assertDemandWriteDenied,
  assertIssuedOwnHttp, assertScoredOwnHttp, assertDemandPrivate,
  assertNoOtherEmployerLeak, assertImmutableIssuedDemandSql,
} from "./tenant-issued-demand-contract.mjs";

const DAY = 86_400_000;
const plain = value => JSON.parse(JSON.stringify(value));
const addDays = (day, amount) => new Date(Date.parse(day + "T00:00:00Z") +
  amount * DAY).toISOString().slice(0, 10);
const hex = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const HISTORIC_COUNTS = [2, 2, 2, 2, 2, 2, 3, 3, 4, 4, 4, 5];
const TABLES = [
  "worksites", "workforceDemandImportBatches", "workforceDemandObservationRevisions",
  "workforceDemandForecastIssues", "workforceDemandForecastScores", "employees",
  "employeePayProfiles", "payrollRuns", "timePunches", "employeeScheduleAssignments",
  "userOrganizations",
];

export async function proveIssuedDemandPosts() {
  // This guard MUST run before any production application/database import.
  const ids = requireDisposableIssuedDemand();
  const [database, schema, drizzle, http, invariant, forecast, evidence] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
    import("./tenant-table-invariants.mjs"),
    import("../../src/lib/workforce-operational-demand-forecast.ts"),
    import("../../src/lib/workforce-issued-demand-evidence.ts"),
  ]);
  const { db, pool } = database;
  const s = schema;
  const { eq, asc, and } = drizzle;
  const request = http.standaloneRequest;
  try {
    const version = await pool.query("SHOW server_version_num");
    assert.equal(Math.floor(Number(version.rows[0]?.server_version_num) / 10000), 16,
      "ISSUED_DEMAND_REFUSED: a real disposable PostgreSQL 16 database is required");
    const [victim, a, b] = invariant.readAllowlistPreseed(
      process.env.TENANT_TABLE_ALLOWLIST_FIXTURE);
    const { excluded } = invariant.readPrivateAllowlistFixture(
      process.env.TENANT_TABLE_ALLOWLIST_FIXTURE);
    const attackers = [a, b];
    const subjects = [a, b, victim, excluded];
    assert.deepEqual(ids, [a.org.id, b.org.id, victim.org.id]);
    assert.ok(victim.org.id > Math.max(a.org.id, b.org.id));
    assert.ok(excluded.org.id > victim.org.id);
    for (const employer of subjects) {
      assert.match(employer.cookie, /^__Host-linaw_session=[a-f0-9]{64}$/);
      assert.ok(employer.marker && employer.owner?.id && employer.worker?.id);
      employer.sourceKey = "synthetic-" + employer.marker.toLowerCase();
    }

    async function snapshot(orgId) {
      const out = {
        organizations: await db.select().from(s.organizations)
          .where(eq(s.organizations.id, orgId)).orderBy(asc(s.organizations.id)),
      };
      for (const name of TABLES) {
        const table = s[name];
        assert.ok(table?.id && table.organizationId, "missing exact snapshot table: " + name);
        out[name] = await db.select().from(table)
          .where(eq(table.organizationId, orgId)).orderBy(asc(table.id));
      }
      out.audit = invariant.auditBusinessSnapshot(await db.select()
        .from(s.auditEvents).where(eq(s.auditEvents.organizationId, orgId))
        .orderBy(asc(s.auditEvents.id)));
      return plain(out);
    }
    const freeze = async () => new Map(await Promise.all(subjects.map(async employer =>
      [employer.org.id, await snapshot(employer.org.id)])));
    const unchangedAll = async (before, label) => {
      for (const employer of subjects) {
        assertImmutableIssuedDemandSql(before.get(employer.org.id),
          await snapshot(employer.org.id), label + ": " + employer.marker);
      }
    };
    const otherMarkers = actor => subjects.filter(e => e !== actor)
      .flatMap(e => [e.marker, e.sourceKey]);
    const post = (path, actor, body, cookie = actor?.cookie) =>
      request(path, { method: "POST", cookie, body });
    async function refused(path, actor, body, status, label, cookie) {
      const before = await freeze();
      const res = await post(path, actor, body, cookie === null ? null : cookie);
      assertDemandWriteDenied(res, status, actor ? otherMarkers(actor) : [victim.marker]);
      await unchangedAll(before, label);
      return res;
    }
    async function allowed(path, actor, body, status, label) {
      const before = await freeze();
      const res = await post(path, actor, body);
      assert.equal(res.status, status,
        label + ": expected HTTP " + status + ", got " + res.status + " " + res.text.slice(0, 180));
      for (const other of subjects.filter(e => e !== actor)) {
        assertImmutableIssuedDemandSql(before.get(other.org.id),
          await snapshot(other.org.id), label + " cannot change " + other.marker);
        assertNoOtherEmployerLeak(res, [other.marker, other.sourceKey]);
      }
      return { res, before: before.get(actor.org.id), after: await snapshot(actor.org.id) };
    }
    function newRows(before, after, table) {
      return after[table].filter(row => !before[table].some(old => old.id === row.id));
    }
    function assertOnlyChanged(before, after, tables, label) {
      for (const name of ["organizations", ...TABLES, "audit"].filter(x => !tables.includes(x))) {
        assert.deepEqual(after[name], before[name], label + " illegally changed " + name);
      }
      for (const table of tables) {
        const unchanged = before[table];
        assert.deepEqual(after[table].filter(row => unchanged.some(old => old.id === row.id)),
          unchanged, label + " must preserve every prior " + table + " row");
      }
    }
    function assertAudit(actor, before, after, action, expectedMetadata) {
      const added = newRows(before, after, "audit");
      assert.equal(added.length, 1, "one and only one audit entry for " + action);
      const audit = added[0];
      assert.equal(audit.organizationId, actor.org.id);
      assert.equal(audit.actor, actor.owner.name);
      assert.equal(audit.action, action);
      for (const [field, value] of Object.entries(expectedMetadata)) {
        assert.deepEqual(audit.metadata?.[field], value,
          action + " audit metadata must bind to persisted own source " + field);
      }
    }
    function issueBody(actor, organizationId = actor.org.id, worksiteId = actor.site.id) {
      return {
        organizationId, worksiteId, sourceKey: actor.sourceKey,
        metricKind: "transactions", intervalMinutes: 30, horizonDays: 7,
        idempotencyKey: actor.issueKey, acknowledged: true,
      };
    }
    const scoreBody = (orgId, issueId) => ({ organizationId: orgId, issueId, acknowledged: true });

    // Four real, unique worksites and source-batch histories. Inserts are in
    // attacker A, attacker B, victim, then excluded order: never guessed IDs.
    const tomorrow = evidence.nextPhDay(new Date());
    for (const actor of subjects) {
      const [site] = await db.insert(s.worksites).values({
        organizationId: actor.org.id, orgUnitId: actor.unit.id,
        code: ("ISS-" + actor.marker).slice(0, 32).toUpperCase(),
        name: actor.marker + " verified fake demand worksite",
        active: true, timezone: "Asia/Manila",
      }).returning();
      actor.site = site;
      actor.issueKey = "wfm-issue-" + randomUUID();
      const historical = HISTORIC_COUNTS.map((count, i) => {
        const day = addDays(tomorrow, -7 * (HISTORIC_COUNTS.length - i));
        const at = new Date(evidence.phIntervalUtc(day, "09:00"));
        return { at, count, recordedAt: new Date(at.getTime() + 3600_000) };
      });
      const [batch] = await db.insert(s.workforceDemandImportBatches).values({
        organizationId: actor.org.id, worksiteId: site.id,
        sourceKey: actor.sourceKey, metricKind: "transactions", intervalMinutes: 30,
        idempotencyKey: "source-" + randomUUID(), rowCount: historical.length,
        requestSha256: hex({ historical, org: actor.org.id, site: site.id }),
        createdByUserId: actor.owner.id,
        importedAt: historical.at(-1).recordedAt,
      }).returning();
      const rows = await db.insert(s.workforceDemandObservationRevisions).values(
        historical.map(row => ({
          organizationId: actor.org.id, worksiteId: site.id, importBatchId: batch.id,
          sourceKey: actor.sourceKey, metricKind: "transactions", intervalMinutes: 30,
          intervalStart: row.at, revision: 1, observedCount: row.count,
          quality: "complete", recordedAt: row.recordedAt,
        }))).returning();
      assert.equal(rows.length, 12);
      actor.historical = rows;
    }
    assert.ok(victim.site.id > Math.max(a.site.id, b.site.id));
    assert.ok(victim.historical.at(-1).id > Math.max(
      a.historical.at(-1).id, b.historical.at(-1).id));

    // A separate, source-bound, **synthetic historical** issue is a scoring
    // fixture. Do not manipulate clock_timestamp() or falsely label this
    // seeded issue an executed POST issue. Genuine scoring is exercised below.
    const oldIssuedAt = new Date(Date.now() - 25 * DAY);
    const oldTarget = evidence.nextPhDay(oldIssuedAt);
    for (const actor of subjects) {
      const rows = actor.historical.filter(row =>
        row.recordedAt <= oldIssuedAt &&
        row.intervalStart.getTime() + 30 * 60_000 <= oldIssuedAt.getTime());
      assert.ok(rows.length >= 9, "historical scoring fixture must have nine real source revisions");
      const oldForecast = forecast.forecastObservedWorkload({
        today: oldTarget, horizonDays: 7,
        metricKind: "transactions", intervalMinutes: 30,
        observations: rows.map(row => ({
          intervalStart: row.intervalStart.toISOString(), intervalMinutes: 30,
          revision: row.revision, observedCount: row.observedCount, quality: row.quality,
        })),
      });
      assert.equal(oldForecast.status, "ready",
        "source histories must independently yield a historical scored candidate");
      const sourceSha = evidence.demandSha256(rows.map(row => ({
        id: row.id, intervalStart: row.intervalStart.toISOString(),
        revision: row.revision, observedCount: row.observedCount,
        quality: row.quality, recordedAt: row.recordedAt.toISOString(),
      })));
      const scope = {
        organizationId: actor.org.id, worksiteId: actor.site.id,
        sourceKey: actor.sourceKey, metricKind: "transactions",
        intervalMinutes: 30, horizonDays: 7,
      };
      const snapshot = evidence.makeIssuedDemandSnapshot({
        scope, issuedAt: oldIssuedAt, evidenceSha256: sourceSha,
        forecast: oldForecast,
      });
      assert.ok(snapshot.points.length > 0);
      const [issue] = await db.insert(s.workforceDemandForecastIssues).values({
        ...scope, idempotencyKey: "old-" + randomUUID(),
        requestSha256: evidence.demandSha256(scope),
        issuedByUserId: actor.owner.id,
        issuedAt: oldIssuedAt, sourceCutoffAt: oldIssuedAt,
        trainingEvidenceSha256: sourceSha, snapshotSha256: evidence.demandSha256(snapshot),
        pointsCount: snapshot.points.length, snapshot,
      }).returning();
      actor.scorableIssue = issue;
      // Source data at the future target is already among the 12 seeded
      // weekly records; unlike the pre-issue nine, it was recorded AFTER
      // the synthetic issue and the complete interval is now settled.
      // Reuse that real SQL revision instead of inserting an impossible
      // duplicate (organization, site, interval, revision=1) row.
      const expectedIntervals = new Set(snapshot.points.map(p => p.intervalStart));
      const actualRows = actor.historical.filter(row =>
        expectedIntervals.has(row.intervalStart.toISOString()));
      assert.equal(actualRows.length, snapshot.points.length,
        "every old issued point needs a genuine later, settled SQL observation");
      actor.scorableActuals = actualRows;
      assert.ok(actualRows.every(row => row.recordedAt > oldIssuedAt &&
        row.intervalStart.getTime() + 30 * 60_000 + DAY < Date.now()),
      "genuine stored actuals must be later than the old issue and settled 24 hours");
    }
    assert.ok(victim.scorableIssue.id > Math.max(
      a.scorableIssue.id, b.scorableIssue.id));
    assert.ok(victim.scorableActuals[0].id > Math.max(
      a.scorableActuals[0].id, b.scorableActuals[0].id));

    const counts = { ownIssue201: 0, ownIssueReplay200: 0, ownScore201: 0,
      ownScoreReplay200: 0, foreignEmployer403: 0, forgedSite403: 0,
      forgedIssue403: 0, earlyScore409: 0, changedKey409: 0,
      forgedSource409: 0, invalidInput400: 0, anonymous401: 0,
      excludedPilot404: 0, missingMfa403: 0 };
    // Actual production HTTP issue, first for both attackers and then for
    // the allowlisted victim, to obtain a genuine higher-ID positive victim.
    for (const actor of [a, b, victim]) {
      const result = await allowed(ISSUE_PATH, actor, issueBody(actor), 201,
        "genuine owned issued forecast");
      const created = newRows(result.before, result.after, "workforceDemandForecastIssues");
      assert.equal(created.length, 1);
      assertOnlyChanged(result.before, result.after,
        ["workforceDemandForecastIssues", "audit"], "owned forecast issue");
      const [persisted] = await db.select().from(s.workforceDemandForecastIssues)
        .where(and(eq(s.workforceDemandForecastIssues.organizationId, actor.org.id),
          eq(s.workforceDemandForecastIssues.id, created[0].id)));
      assert.deepEqual(plain(persisted), created[0]);
      assert.equal(evidence.demandSha256(persisted.snapshot), persisted.snapshotSha256);
      assertIssuedOwnHttp(result.res, persisted, actor, otherMarkers(actor));
      assert.equal(result.res.json.issuedAt, persisted.issuedAt.toISOString());
      assertAudit(actor, result.before, result.after,
        "WFM future aggregate demand forecast issued", {
          issueId: persisted.id, snapshotSha256: persisted.snapshotSha256,
          trainingEvidenceSha256: persisted.trainingEvidenceSha256,
          pointsCount: persisted.pointsCount,
        });
      actor.realIssue = persisted;
      counts.ownIssue201++;
    }
    assert.ok(victim.realIssue.id > Math.max(a.realIssue.id, b.realIssue.id));

    for (const actor of attackers) {
      const other = actor === a ? b : a;
      const goodBody = issueBody(actor);
      const replay = await allowed(ISSUE_PATH, actor, goodBody, 200, "issued replay");
      assertImmutableIssuedDemandSql(replay.before, replay.after,
        "replay must not create source, issue, audit, roster or payroll rows");
      assertDemandPrivate(replay.res.headers);
      assert.equal(replay.res.json?.replayed, true);
      assert.equal(replay.res.json.issueId, actor.realIssue.id);
      assert.equal(replay.res.json.snapshotSha256, actor.realIssue.snapshotSha256);
      counts.ownIssueReplay200++;
      await refused(ISSUE_PATH, actor, { ...goodBody, horizonDays: 14 },
        409, "same idempotency key cannot change horizon");
      counts.changedKey409++;
      await refused(ISSUE_PATH, actor,
        { ...goodBody, organizationId: victim.org.id, worksiteId: victim.site.id },
        403, "signed-in attacker cannot issue for allowlisted real victim");
      counts.foreignEmployer403++;
      await refused(ISSUE_PATH, actor,
        { ...goodBody, worksiteId: victim.site.id },
        403, "victim higher-ID worksite cannot be issued within attacker's employer");
      counts.forgedSite403++;
      await refused(ISSUE_PATH, actor,
        { ...goodBody, sourceKey: victim.sourceKey,
          idempotencyKey: "forged-" + randomUUID() },
        409, "foreign sourceKey has no genuine own history");
      counts.forgedSource409++;
      await refused(ISSUE_PATH, actor,
        { ...goodBody, customerId: victim.worker.id },
        400, "reject unreviewed person-level JSON input");
      counts.invalidInput400++;
      await refused(ISSUE_PATH, actor, goodBody, 401, "anonymous issued POST", null);
      counts.anonymous401++;
      const noMfa = await http.standaloneMakeSession(actor.owner.id);
      const noMfaResponse = await refused(ISSUE_PATH, actor,
        { ...goodBody, idempotencyKey: "no-mfa-" + randomUUID() },
        403, "issue still requires MFA", noMfa.cookie);
      assert.equal(noMfaResponse.json?.code, "MFA_REQUIRED");
      counts.missingMfa403++;
      assert.ok(!other.marker.includes(victim.marker));
    }
    await refused(ISSUE_PATH, excluded, issueBody(excluded), 404,
      "excluded fourth employer is disabled in the source pilot");
    counts.excludedPilot404++;

    // One real HTTP POST /score per actor. All source dates are already settled.
    // No direct score table insertion is permitted anywhere in this harness.
    for (const actor of [a, b, victim]) {
      const result = await allowed(SCORE_PATH, actor,
        scoreBody(actor.org.id, actor.scorableIssue.id), 201,
        "real owned one-time final score");
      const created = newRows(result.before, result.after, "workforceDemandForecastScores");
      assert.equal(created.length, 1);
      assertOnlyChanged(result.before, result.after,
        ["workforceDemandForecastScores", "audit"], "owned final score");
      const [persisted] = await db.select().from(s.workforceDemandForecastScores)
        .where(and(eq(s.workforceDemandForecastScores.organizationId, actor.org.id),
          eq(s.workforceDemandForecastScores.id, created[0].id)));
      assert.deepEqual(created[0], plain(persisted));
      assert.equal(evidence.demandSha256(persisted.report), persisted.reportSha256);
      assertScoredOwnHttp(result.res, persisted, actor.scorableIssue,
        actor, otherMarkers(actor));
      assertAudit(actor, result.before, result.after,
        "WFM future aggregate demand forecast scored", {
          issueId: actor.scorableIssue.id, scoreId: persisted.id,
          snapshotSha256: actor.scorableIssue.snapshotSha256,
          scoreSha256: persisted.reportSha256,
          comparisonCount: persisted.pointsCount,
        });
      for (const p of persisted.report.points) {
        assert.ok(actor.scorableActuals.some(actual =>
          actual.id === p.observationRevisionId &&
          actual.observedCount === p.reportedCount &&
          actual.intervalStart.toISOString() === p.intervalStart),
        "frozen score must bind real own later actual SQL observation revision IDs");
      }
      actor.realScore = persisted;
      counts.ownScore201++;
    }
    assert.ok(victim.realScore.id > Math.max(a.realScore.id, b.realScore.id));

    for (const actor of attackers) {
      const originalScore = actor.realScore;
      const reply = await allowed(SCORE_PATH, actor,
        scoreBody(actor.org.id, actor.scorableIssue.id), 200, "immutable score replay");
      assertImmutableIssuedDemandSql(reply.before, reply.after,
        "second scoring request must not rewrite an already frozen score");
      assertDemandPrivate(reply.res.headers);
      assert.equal(reply.res.json?.replayed, true);
      assert.equal(reply.res.json.scoreId, originalScore.id);
      assert.equal(reply.res.json.reportSha256, originalScore.reportSha256);
      counts.ownScoreReplay200++;
      const premature = await refused(SCORE_PATH, actor,
        scoreBody(actor.org.id, actor.realIssue.id), 409,
        "current issued forecast is still in the future");
      assert.ok(premature.json?.missingIntervals > 0);
      counts.earlyScore409++;
      await refused(SCORE_PATH, actor,
        scoreBody(victim.org.id, victim.scorableIssue.id), 403,
        "attacker cannot score real allowlisted victim employer");
      counts.foreignEmployer403++;
      await refused(SCORE_PATH, actor,
        scoreBody(actor.org.id, victim.scorableIssue.id), 403,
        "attacker cannot steal victim's higher-ID issueId");
      counts.forgedIssue403++;
      await refused(SCORE_PATH, actor,
        { ...scoreBody(actor.org.id, actor.scorableIssue.id),
          employeeId: victim.worker.id }, 400,
        "score must reject arbitrary person-level selectors");
      counts.invalidInput400++;
      await refused(SCORE_PATH, actor,
        scoreBody(actor.org.id, actor.scorableIssue.id), 401,
        "anonymous final score POST", null);
      counts.anonymous401++;
      const noMfa = await http.standaloneMakeSession(actor.owner.id);
      const mfa = await refused(SCORE_PATH, actor,
        scoreBody(actor.org.id, actor.scorableIssue.id), 403,
        "score still requires MFA", noMfa.cookie);
      assert.equal(mfa.json?.code, "MFA_REQUIRED");
      counts.missingMfa403++;

      // Source corrections after the one-time score must never replace it.
      // These are synthetic database fixtures, not a provider sync.
      const target = actor.scorableActuals[0];
      const [batch] = await db.insert(s.workforceDemandImportBatches).values({
        organizationId: actor.org.id, worksiteId: actor.site.id,
        sourceKey: actor.sourceKey, metricKind: "transactions", intervalMinutes: 30,
        idempotencyKey: "late-" + randomUUID(),
        requestSha256: hex({ late: target.id }), rowCount: 1,
        createdByUserId: actor.owner.id,
      }).returning();
      await db.insert(s.workforceDemandObservationRevisions).values({
        organizationId: actor.org.id, worksiteId: actor.site.id,
        importBatchId: batch.id, sourceKey: actor.sourceKey,
        metricKind: "transactions", intervalMinutes: 30,
        intervalStart: target.intervalStart, revision: 2,
        observedCount: 100 + actor.rank, quality: "complete",
        recordedAt: new Date(),
      });
      const frozen = await allowed(SCORE_PATH, actor,
        scoreBody(actor.org.id, actor.scorableIssue.id), 200,
        "late source correction cannot rewrite frozen score");
      assertImmutableIssuedDemandSql(frozen.before, frozen.after,
        "late actual revision cannot create another scoring audit or score");
      assert.equal(frozen.res.json.reportSha256, originalScore.reportSha256);
      assert.deepEqual(frozen.res.json.report, originalScore.report);
    }
    await refused(SCORE_PATH, excluded,
      scoreBody(excluded.org.id, excluded.scorableIssue.id), 404,
      "excluded fourth employer cannot score a synthetic issue without pilot");
    counts.excludedPilot404++;
    const verified = await freeze();
    // Required negative control: a borrowed SQL positive must never satisfy the
    // other employer's positive response assertion.
    const foreignBefore = a.realScore;
    assert.notEqual(foreignBefore.organizationId, b.org.id);
    assert.throws(() => assertScoredOwnHttp(
      { status: 201, json: { issueId: foreignBefore.issueId,
        scoreId: foreignBefore.id, reportSha256: foreignBefore.reportSha256,
        report: foreignBefore.report, readOnlyScore: true,
        boundary: "Final source-reported workload score. No employee, schedule, payroll or payout decision.",
        replayed: false }, text: JSON.stringify(foreignBefore),
      headers: { get: () => "private, no-store", entries: () => [] } },
      foreignBefore, b.scorableIssue, b, []),
    "another employer's positive score cannot certify this attacker");
    await unchangedAll(verified, "response-substitution negative control");
    assert.deepEqual(ISSUED_DEMAND_POST_METHODS, [
      "POST workforce/demand-observations/issued",
      "POST workforce/demand-observations/issued/score",
    ]);
    console.log(JSON.stringify({
      kind: "tenant-issued-demand-post-candidate",
      exactMethods: ISSUED_DEMAND_POST_METHODS, fictionalEmployers: 4,
      realAttackers: 2, realHigherIdVictim: true, nonAllowlistedEmployer: true,
      realPG16: true, realLocalhostHttp: true,
      ownSourceBoundIssuerAndFrozenScore: true,
      historicIssueWasSyntheticFixture: true,
      settledActualsWereSyntheticFixture: true,
      externalProviderCalls: 0, loyverseEnabled: false, squareSandboxEnabled: false,
      payrollWrites: 0, rosterWrites: 0, productionTested: false,
      coverageCredits: 0, independentlyAccepted: false, ...counts,
    }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/tenant-issued-demand-http.mjs")) {
  proveIssuedDemandPosts().then(() => process.exit(0), err => {
    console.error(err instanceof Error ? err.message : "issued demand proof failed");
    process.exit(1);
  });
}
