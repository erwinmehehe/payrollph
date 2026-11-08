/**
 * Standalone EDG-01 anonymous applicant POST proof. This tests a public
 * employer/requisition pair, NOT a signed-in tenant-private endpoint.
 * Disposable fictional PostgreSQL 16 and real localhost production-mode HTTP
 * only. No production migration, money or provider operation, and zero credits.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  METHOD, NOTICE_VERSION, requireDisposableApplicationEnv,
  assertPublicReply, assertUnchanged, assertApplicationTransition,
} from "./tenant-edg01-careers-application-contract.mjs";

const BASE = "http://127.0.0.1:3000";
let ipNumber = 10;

async function request(path, body) {
  assert.ok(ipNumber < 220, "refuse exhausted reserved fictional IP range");
  const response = await fetch(BASE + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: BASE,
      "sec-fetch-site": "same-origin",
      // RFC 5737 documentation-only IPs; CI uses one explicitly simulated
      // trusted localhost proxy hop to exercise separate rate-limit subjects.
      "x-forwarded-for": "192.0.2." + ipNumber++,
    },
    body: JSON.stringify(body),
    redirect: "manual",
    cache: "no-store",
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 500 may be HTML */ }
  return { status: response.status, text, json, headers: response.headers };
}

async function intakeProof(email) {
  const response = await request("/api/intake-challenge", { email });
  assert.equal(response.status, 200, "a real issued challenge is required");
  assert.equal(response.json?.enabled, true);
  const token = response.json?.token;
  assert.ok(typeof token === "string" && token.length > 20);
  assert.equal(response.json?.difficulty, 16);
  assert.ok(response.json?.expires > Date.now());
  for (let nonce = 0; nonce < 0xffffffff; nonce++) {
    if (createHash("sha256").update(token + ":" + nonce).digest("hex").startsWith("0000")) {
      return { token, nonce };
    }
  }
  throw new Error("fictional public intake challenge could not be solved");
}

async function apply(candidate) {
  return request("/api/careers", { ...candidate, intakeProof: await intakeProof(candidate.email) });
}

function candidate(employer, suffix) {
  const email = "edg01-" + suffix + "-" + employer.label.toLowerCase() +
    "-" + employer.nonce + "@example.invalid";
  return {
    organizationId: employer.org.id,
    requisitionId: employer.job.id,
    fullName: "Fictional applicant " + employer.label + " " + suffix,
    email,
    phone: "+63 900 000 0000",
    notes: "Synthetic recruiting intake only " + employer.marker,
    consent: true,
    privacyNoticeVersion: NOTICE_VERSION,
  };
}

async function main() {
  // Refuse non-CI/nonlocal/prod-target contexts BEFORE importing DB/Next code.
  requireDisposableApplicationEnv();
  const [{ db, pool }, s, orm, fixtures] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  fixtures.requireTenantTableDisposable();
  const { eq, asc } = orm;
  try {
    const version = await pool.query("show server_version_num");
    assert.equal(Math.floor(Number(version.rows[0].server_version_num) / 10000), 16,
      "EDG01_APPLICATION_REFUSED: PostgreSQL 16 required");
    const state = await pool.query(
      "select (select count(*)::int from organizations) as organizations, " +
      "(select count(*)::int from users) as users, " +
      "(select count(*)::int from audit_events) as audits");
    assert.deepEqual(state.rows[0], { organizations: 0, users: 0, audits: 0 },
      "EDG01_APPLICATION_REFUSED: only a fresh fictional database is allowed");
    const column = await pool.query("select careers_published from job_requisitions limit 0");
    assert.ok(column.fields.some(field => field.name === "careers_published"),
      "only a disposable reviewed careers column may be used");

    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const employers = [];
    for (const label of ["ATTA", "ATTB", "VICTIM"]) {
      const e = await fixtures.seedEmployer(label, nonce, fixtures.standaloneMakeSession);
      e.nonce = nonce;
      const [profile] = await db.insert(s.jobProfiles).values({
        organizationId: e.org.id, title: e.marker + " candidate-proof profile",
      }).returning();
      const [position, closedPosition] = await db.insert(s.positions).values([
        { organizationId: e.org.id, jobProfileId: profile.id,
          code: "EDGAPP-" + label, status: "open", orgUnitId: e.unit.id },
        { organizationId: e.org.id, jobProfileId: profile.id,
          code: "EDGAPP-CLOSED-" + label, status: "filled", orgUnitId: e.unit.id },
      ]).returning();
      if (label !== "VICTIM") {
        await db.insert(s.jobRequisitions).values([0, 1].map(index => ({
          organizationId: e.org.id,
          positionId: null,
          title: e.marker + " cancelled ID padding " + index,
          department: e.marker + " recruiting", status: "cancelled",
        })));
      }
      const [job, closedJob] = await db.insert(s.jobRequisitions).values([
        { organizationId: e.org.id, positionId: position.id,
          title: e.marker + " public opening",
          department: e.marker + " recruiting", status: "open" },
        { organizationId: e.org.id, positionId: closedPosition.id,
          title: e.marker + " closed opening",
          department: e.marker + " recruiting", status: "filled" },
      ]).returning();
      const published = await pool.query(
        "update job_requisitions set careers_published=true where id=$1 and organization_id=$2",
        [job.id, e.org.id],
      );
      assert.equal(published.rowCount, 1, "must publish precisely one real owned job");
      const [baseline] = await db.insert(s.jobApplicants).values({
        organizationId: e.org.id,
        requisitionId: job.id,
        fullName: e.marker + " preexisting fictional applicant",
        email: "prior-" + label.toLowerCase() + "-" + nonce + "@example.invalid",
      }).returning();
      await db.insert(s.applicantPrivacyEvidence).values({
        organizationId: e.org.id, applicantId: baseline.id, legalBasis: "consent",
        privacyNoticeVersion: NOTICE_VERSION,
        sourceEvidenceReference: "ci-prior:" + label + "-" + nonce,
        consentCapturedAt: new Date(),
      });
      await db.insert(s.payrollRuns).values({
        organizationId: e.org.id, legalEntityId: e.entity.id,
        periodLabel: "FICTIONAL EDG01 " + label,
        periodStart: "2026-10-01", periodEnd: "2026-10-15",
        payDate: "2026-10-20", status: "Draft",
      });
      e.job = job;
      e.closedJob = closedJob;
      employers.push(e);
    }

    const [attackerA, attackerB, victim] = employers;
    assert.ok(victim.job.id > 6, "victim must have a real higher SQL ID");
    for (const attacker of [attackerA, attackerB]) {
      assert.ok(victim.org.id > attacker.org.id && victim.job.id > attacker.job.id,
        "two lower-ID attackers and a persisted higher-ID victim required");
    }

    const snapshot = async employer => {
      const rows = table => db.select().from(table)
        .where(eq(table.organizationId, employer.org.id)).orderBy(asc(table.id));
      const [jobs, applicants, privacy, audits, payroll] = await Promise.all([
        pool.query("select * from job_requisitions where organization_id=$1 order by id",
          [employer.org.id]).then(result => result.rows),
        rows(s.jobApplicants),
        rows(s.applicantPrivacyEvidence),
        rows(s.auditEvents),
        rows(s.payrollRuns),
      ]);
      return { jobs, applicants, privacy, audits, payroll };
    };
    const snapshotAll = () => Promise.all(employers.map(snapshot));
    const forbidden = [victim.marker, victim.job.title,
      "prior-victim-" + nonce + "@example.invalid"];
    let persistedOwn = 0;
    let deniedPairs = 0;

    for (const employer of employers) {
      const i = employers.indexOf(employer);
      const before = await snapshotAll();
      const fields = candidate(employer, "own");
      const response = await apply(fields);
      assertPublicReply(response, 202, forbidden);
      const after = await snapshotAll();
      assertApplicationTransition(before[i], after[i], employer, fields);
      for (let j = 0; j < employers.length; j++) {
        if (i !== j) assertUnchanged(before[j], after[j],
          "legitimate public intake must not change another employer");
      }
      persistedOwn++;
    }

    // A public applicant may intentionally apply to ANY published employer
    // when both selectors match. These denials only prove that an attacker
    // cannot splice a real victim job ID into a different employer context.
    for (const attacker of [attackerA, attackerB]) {
      const cases = [
        { organizationId: attacker.org.id, requisitionId: victim.job.id },
        { organizationId: victim.org.id, requisitionId: attacker.job.id },
      ];
      for (const [index, selector] of cases.entries()) {
        const before = await snapshotAll();
        const response = await apply({
          ...candidate(attacker, "cross-" + index), ...selector,
        });
        assertPublicReply(response, 404, forbidden);
        assertUnchanged(before, await snapshotAll(),
          attacker.label + " mismatched employer and real foreign requisition");
        deniedPairs++;
      }
    }

    const beforeClosed = await snapshotAll();
    const closed = await apply({
      ...candidate(attackerA, "closed"), requisitionId: attackerA.closedJob.id,
    });
    assertPublicReply(closed, 404, forbidden);
    assertUnchanged(beforeClosed, await snapshotAll(),
      "closed job must not receive an application");

    const beforeDuplicate = await snapshotAll();
    const duplicate = await apply(candidate(attackerA, "own"));
    assertPublicReply(duplicate, 202, forbidden);
    assertUnchanged(beforeDuplicate, await snapshotAll(),
      "identical public receipt must not create a second applicant or audit");

    const beforeReplay = await snapshotAll();
    const replayCandidate = {
      ...candidate(attackerB, "replay"), requisitionId: victim.job.id,
    };
    const consumedProof = await intakeProof(replayCandidate.email);
    const first = await request("/api/careers", {
      ...replayCandidate, intakeProof: consumedProof,
    });
    assertPublicReply(first, 404, forbidden);
    const replay = await request("/api/careers", {
      ...replayCandidate, intakeProof: consumedProof,
    });
    assert.equal(replay.status, 422, "one-use proof must refuse replay");
    assertUnchanged(beforeReplay, await snapshotAll(),
      "proof replay cannot create a private application");

    const beforeConsent = await snapshotAll();
    const noConsent = await request("/api/careers", {
      ...candidate(attackerB, "no-consent"), consent: false,
    });
    assert.equal(noConsent.status, 422, "missing consent must fail before DB insert");
    assertUnchanged(beforeConsent, await snapshotAll(),
      "no consent cannot insert an applicant");

    // A fault at the ACTUAL audit INSERT must roll back applicant and
    // privacy-evidence writes. Sequence increments survive transaction
    // rollback and independently attest that the trigger was reached.
    await pool.query("create sequence ci_edg01_app_audit_veto_hits");
    await pool.query(
      "create function ci_edg01_app_audit_veto() returns trigger " +
      "language plpgsql as $$ begin " +
      "if new.action = 'Published careers application received' then " +
      "perform nextval('ci_edg01_app_audit_veto_hits'); " +
      "raise exception 'CI_EDG01_APPLICATION_AUDIT_VETO'; end if; " +
      "return new; end; $$",
    );
    const vetoFields = candidate(victim, "audit-veto");
    try {
      await pool.query(
        "create trigger ci_edg01_app_audit_veto_trigger " +
        "before insert on audit_events for each row " +
        "execute function ci_edg01_app_audit_veto()");
      const beforeVeto = await snapshotAll();
      const vetoResponse = await apply(vetoFields);
      assert.equal(vetoResponse.status, 500,
        "a reached audit failure cannot return a successful candidate receipt");
      const sequence = await pool.query(
        "select last_value, is_called from ci_edg01_app_audit_veto_hits",
      );
      assert.equal(sequence.rows[0].is_called, true,
        "actual audit INSERT veto must have been reached");
      assert.equal(Number(sequence.rows[0].last_value), 1,
        "exactly one attempted synthetic application audit must be vetoed");
      assertUnchanged(beforeVeto, await snapshotAll(),
        "audit-veto must roll back private applicant and consent evidence");
    } finally {
      await pool.query(
        "drop trigger if exists ci_edg01_app_audit_veto_trigger on audit_events");
      await pool.query("drop function if exists ci_edg01_app_audit_veto()");
      await pool.query("drop sequence if exists ci_edg01_app_audit_veto_hits");
    }

    // A fresh proof can succeed once the artificial veto is removed.
    const beforeRecovery = await snapshotAll();
    const recovery = await apply(vetoFields);
    assertPublicReply(recovery, 202, forbidden);
    const afterRecovery = await snapshotAll();
    assertApplicationTransition(beforeRecovery[2], afterRecovery[2], victim, vetoFields);
    assertUnchanged(beforeRecovery[0], afterRecovery[0], "recovery A isolation");
    assertUnchanged(beforeRecovery[1], afterRecovery[1], "recovery B isolation");
    console.log("EDG01_CAREERS_APPLICATION_REAL_HTTP " + JSON.stringify({
      method: METHOD,
      employers: 3, independentAttackers: 2, higherIdVictim: true,
      persistedOwnApplications: persistedOwn + 1,
      mismatchedEmployerRequisitionDenials: deniedPairs,
      duplicateSuppressed: true, replayRefused: true, missingConsentRefused: true,
      auditVetoActuallyReached: true, auditRollback: true,
      applicantPrivacyEvidenceAtomic: true, unrelatedDraftPayrollUnchanged: true,
      publicEndpointNotSignedInPrivate: true, disposablePg16: true,
      coverageCredits: 0, productionAccepted: false, moneyMoved: false,
      independentReviewPending: true,
    }));
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error("EDG01_CAREERS_APPLICATION_FAILED",
    error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
