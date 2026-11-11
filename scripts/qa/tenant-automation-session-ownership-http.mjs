/**
 * Actual PG16 + localhost Next proof of Studio separation side effects.
 * No production data, providers, money, worker jobs, or tenant coverage credit.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

function requireDisposable(env = process.env) {
  const expected = {
    CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
    TENANT_SESSION_OWNERSHIP_PROOF: "fictional-pg16-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    APP_BASE_URL: "http://127.0.0.1:3000", SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    TRUSTED_APP_ORIGINS: "http://127.0.0.1:3000", DEMO_MODE: "false",
    WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false", AUTOMATION_LANGUAGE_STUDIO_ENABLED: "false",
    OPENAI_AUTOMATION_DRAFT_ENABLED: "false", REQUIRE_PRIVILEGED_MFA: "true",
  };
  for (const [name, value] of Object.entries(expected)) {
    assert.equal(env[name], value, "SESSION_PROOF_REFUSED: " + name);
  }
  for (const secret of [
    "NEON_DATABASE_URL", "PAYMONGO_SECRET_KEY", "PAYMONGO_WALLET_ID",
    "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY", "RESEND_API_KEY",
    "OPENAI_API_KEY", "STRIPE_SECRET_KEY", "SMTP_PASSWORD", "SMTP_URL",
  ]) assert.ok(!env[secret], "SESSION_PROOF_REFUSED: " + secret);
  return true;
}
export { requireDisposable };

async function main() {
  // Nothing may import the app or touch a DB before this safety interlock.
  requireDisposable();
  const [{ db, pool }, s, { and, asc, eq, inArray }, fixture] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  try {
    const pg = Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
    assert.ok(pg >= 160000 && pg < 170000, "Only disposable PostgreSQL 16");
    for (const table of [s.users, s.organizations, s.automationExecutions]) {
      assert.equal((await db.select().from(table).limit(1)).length, 0,
        "Refuse a pre-existing employer, user or execution");
    }

    const nonce = randomUUID().slice(0, 10);
    const attacker = await fixture.seedEmployer("OWN", nonce, fixture.standaloneMakeSession);
    const peer = await fixture.seedEmployer("PEER", nonce, fixture.standaloneMakeSession);
    for (let i = 0; i < 7; i++) {
      await fixture.seedEmployer("FILL" + i, nonce, fixture.standaloneMakeSession);
    }
    const victim = await fixture.seedEmployer("VICTIM", nonce, fixture.standaloneMakeSession);
    assert.ok(victim.org.id > Math.max(attacker.org.id, peer.org.id, 6),
      "Victim employer must have real higher-ID data");
    assert.ok(victim.worker.id > Math.max(attacker.worker.id, peer.worker.id, 6));

    async function linkedAccount(label, memberships) {
      const [user] = await db.insert(s.users).values({
        email: "session-scope-" + label + "-" + nonce + "@example.invalid",
        name: "Fictional " + label, role: "employee",
        employeeId: attacker.worker.id,
        passwordHash: "not-a-login-secret",
      }).returning();
      await db.insert(s.userOrganizations).values(memberships.map(org => ({
        userId: user.id, organizationId: org.id, role: "employee", active: true,
      })));
      const session = await fixture.standaloneMakeSession(user.id);
      return { user, session };
    }
    const own = await linkedAccount("own", [attacker.org]);
    const peerOnly = await linkedAccount("peer", [peer.org]);
    const victimOnly = await linkedAccount("victim", [victim.org]);
    const foreignIds = [peerOnly.user.id, victimOnly.user.id];
    const ownedWorkerId = attacker.worker.id;

    async function snapshotForeign() {
      const out = {};
      for (const org of [peer.org, victim.org]) {
        out[org.id] = {
          memberships: await db.select().from(s.userOrganizations)
            .where(eq(s.userOrganizations.organizationId, org.id))
            .orderBy(asc(s.userOrganizations.id)),
          audits: await db.select().from(s.auditEvents)
            .where(eq(s.auditEvents.organizationId, org.id)).orderBy(asc(s.auditEvents.id)),
        };
      }
      out.foreignUsers = await db.select().from(s.users)
        .where(inArray(s.users.id, foreignIds)).orderBy(asc(s.users.id));
      out.foreignSessions = await db.select().from(s.sessions)
        .where(inArray(s.sessions.userId, foreignIds)).orderBy(asc(s.sessions.id));
      return out;
    }
    function post(action, executionId) {
      return fixture.standaloneRequest("/api/automation-studio", {
        method: "POST", cookie: attacker.cookie,
        body: { organizationId: attacker.org.id, action, executionId, stepIndex: 0 },
      });
    }
    async function failedExecution(type, label) {
      const [rule] = await db.insert(s.automationRules).values({
        organizationId: attacker.org.id,
        name: "Session isolation " + label + " " + nonce,
        trigger: "employee.separated", active: false,
        publishedVersion: 0, draftVersion: 1, actions: [{ type }],
      }).returning();
      const [execution] = await db.insert(s.automationExecutions).values({
        organizationId: attacker.org.id, ruleId: rule.id,
        employeeId: ownedWorkerId, trigger: "employee.separated",
        eventKey: "session-proof-" + label + "-" + randomUUID(),
        workflow: [{ type }], context: { synthetic: true },
        status: "failed", cursor: 1, error: "Synthetic interrupted action",
        result: [{ type, stepIndex: 0, status: "failed", error: "Synthetic interrupted action" }],
      }).returning();
      return execution;
    }
    async function sessionState(session) {
      return (await db.select().from(s.sessions).where(eq(s.sessions.id, session.id)))[0];
    }
    const beforeForeign = await snapshotForeign();
    assert.equal((await sessionState(own.session)).revokedAt, null);
    assert.equal((await sessionState(peerOnly.session)).revokedAt, null);
    assert.equal((await sessionState(victimOnly.session)).revokedAt, null);

    // Positive retry: only the employer's own login can be signed out.
    const r1 = await post("retry-execution-step", (await failedExecution("revoke_sessions", "retry")).id);
    assert.equal(r1.status, 200, r1.text.slice(0, 250));
    assert.equal(r1.json?.execution?.status, "completed");
    assert.equal(r1.json.execution.result.at(-1)?.revoked, 1);
    assert.ok((await sessionState(own.session)).revokedAt, "Own session must be revoked");
    assert.deepEqual(await snapshotForeign(), beforeForeign, "Retry mutated peer/victim employer");

    // Positive replay: same authorization holds for stored-snapshot replay.
    const ownAgain = await fixture.standaloneMakeSession(own.user.id);
    const r2 = await post("replay-execution", (await failedExecution("revoke_sessions", "replay")).id);
    assert.equal(r2.status, 201, r2.text.slice(0, 250));
    assert.equal(r2.json?.execution?.status, "completed");
    assert.ok((await sessionState(ownAgain)).revokedAt, "Replay must revoke own session");
    assert.deepEqual(await snapshotForeign(), beforeForeign, "Replay mutated foreign employer");

    // Shared login: A can disable A membership, but cannot globally log out B.
    const shared = await linkedAccount("shared", [attacker.org, victim.org]);
    const sharedBefore = await sessionState(shared.session);
    const sharedForeign = await snapshotForeign();
    const ownBeforeShared = await fixture.standaloneMakeSession(own.user.id);
    const r3 = await post("retry-execution-step", (await failedExecution("revoke_sessions", "shared")).id);
    assert.equal(r3.status, 200, r3.text.slice(0, 250));
    assert.equal(r3.json?.execution?.status, "failed", "Shared logout must fail closed");
    assert.match(r3.json.execution.result.at(-1)?.error ?? "", /another active employer/i);
    assert.equal((await sessionState(ownBeforeShared)).revokedAt, null,
      "Shared-account refusal cannot partially revoke A sessions");
    assert.deepEqual(await sessionState(shared.session), sharedBefore);
    assert.deepEqual(await snapshotForeign(), sharedForeign,
      "Shared-account refusal mutated victim employer");

    // Deactivate A membership and A-only sessions, preserving B's membership,
    // B-only account and globally shared session.
    const r4 = await post("retry-execution-step", (await failedExecution("deactivate_access", "deactivate")).id);
    assert.equal(r4.status, 200, r4.text.slice(0, 250));
    assert.equal(r4.json?.execution?.status, "completed");
    const effect = r4.json.execution.result.at(-1);
    assert.equal(effect.membershipsDeactivated, 2);
    assert.equal(effect.sharedLoginSessionsPreserved, 1);
    assert.ok((await sessionState(ownBeforeShared)).revokedAt,
      "Single-employer A account must be logged out");
    assert.deepEqual(await sessionState(shared.session), sharedBefore,
      "Shared B session must survive A offboarding");
    assert.deepEqual(await snapshotForeign(), sharedForeign,
      "A offboarding changed B or victim employer rows/audits/sessions");
    const memberA = await db.select().from(s.userOrganizations).where(and(
      eq(s.userOrganizations.organizationId, attacker.org.id),
      inArray(s.userOrganizations.userId, [own.user.id, shared.user.id])));
    assert.equal(memberA.length, 2);
    assert.ok(memberA.every(row => row.active === false), "A-only membership must be disabled");

    console.log("TENANT_AUTOMATION_SESSION_SCOPE_PG16_PASS " + JSON.stringify({
      fictionalPG16: true, twoForeignEmployers: true, higherIdVictim: true,
      ownRetry: true, ownReplay: true, foreignSessionsUnchanged: true,
      sharedAccountFailClosed: true, employerMembershipDeactivation: true,
      sharedGlobalSessionPreserved: true, providerCalls: 0, moneyMoved: false,
      newMethodCredits: 0, productionAccepted: false,
    }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith("tenant-automation-session-ownership-http.mjs")) {
  main().catch(error => {
    console.error("TENANT_AUTOMATION_SESSION_SCOPE_PG16_FAIL", error?.stack ?? String(error));
    process.exitCode = 1;
  });
}
