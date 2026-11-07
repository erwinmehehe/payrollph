/**
 * One uncredited method: DELETE /api/de-minimis.
 * Exact-head, fictional PostgreSQL 16 + localhost production-mode HTTP only.
 * Refuses any production DB, remote server, provider, scheduler or payout.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  assertHiddenGrant, assertForeignEqualsMissing, assertOwnedGrantEnded,
} from "./tenant-de-minimis-delete-contract.mjs";

function requireDisposable(env = process.env) {
  for (const [key, value] of Object.entries({
    GITHUB_ACTIONS: "true",
    CI: "true",
    NODE_ENV: "production",
    TENANT_DE_MINIMIS_MODE: "isolated-ci-only",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    APP_BASE_URL: "https://payroll.example.test",
    DEMO_MODE: "false",
    WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    REQUIRE_PRIVILEGED_MFA: "true",
  })) assert.equal(env[key], value, "DE_MINIMIS_TENANT_REFUSED: " + key);
  for (const key of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY",
    "RESEND_API_KEY", "STRIPE_SECRET_KEY", "SMTP_URL", "MAILGUN_API_KEY"]) {
    assert.ok(!env[key], "DE_MINIMIS_TENANT_REFUSED: provider credential " + key);
  }
}

export async function proveDeMinimisDelete() {
  // No DB/app imports or network calls may occur before the disposable guard.
  requireDisposable();
  const [{ db, pool }, s, orm, http] = await Promise.all([
    import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
    import("drizzle-orm"), import("./tenant-table-http.mjs"),
  ]);
  const { eq, and, asc } = orm;
  try {
    const { rows: [initial] } = await pool.query(
      "select current_setting('server_version_num')::int as version, " +
      "(select count(*)::int from organizations) as organizations, " +
      "(select count(*)::int from users) as users, " +
      "(select count(*)::int from de_minimis_grants) as grants");
    assert.equal(Math.floor(initial.version / 10000), 16, "PG16 required");
    assert.deepEqual([initial.organizations, initial.users, initial.grants],
      [0, 0, 0], "fresh empty fictional database required");

    const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
    const actors = [];
    for (const label of ["ATTA", "ATTB", "VICTIM"]) {
      actors.push(await http.seedEmployer(label, nonce, http.standaloneMakeSession));
    }
    const [a, b, victim] = actors;
    assert.ok(victim.org.id > b.org.id && victim.org.id > a.org.id);
    assert.ok(victim.worker.id > b.worker.id && victim.worker.id > a.worker.id);
    // The route's DELETE uses no benefit calculation. Seed the actual schema
    // using the production rule keys, never invented grant types.
    const { DE_MINIMIS_2026 } = await import("../../src/lib/ph-compliance.ts");
    const benefitTypes = Object.keys(DE_MINIMIS_2026);
    assert.ok(benefitTypes.length >= 2, "real benefit types needed for controls");
    for (const actor of actors) {
      const [primary, peer] = await db.insert(s.deMinimisGrants).values(
        benefitTypes.slice(0, 2).map((benefitType, i) => ({
          organizationId: actor.org.id, employeeId: actor.worker.id,
          benefitType, amount: i ? "75.00" : "100.00",
          frequency: String(DE_MINIMIS_2026[benefitType].period),
          effectiveOn: "2026-06-01",
        })),
      ).returning();
      actor.primary = primary;
      actor.peer = peer;
    }
    assert.ok(victim.primary.id > a.peer.id && victim.primary.id > b.peer.id,
      "real victim grant must have a strictly higher ID");
    const snapshot = async () => {
      const result = {};
      for (const e of actors) {
        result[e.label] = {
          grants: await db.select().from(s.deMinimisGrants)
            .where(eq(s.deMinimisGrants.organizationId, e.org.id))
            .orderBy(asc(s.deMinimisGrants.id)),
          audit: await db.select().from(s.auditEvents)
            .where(eq(s.auditEvents.organizationId, e.org.id))
            .orderBy(asc(s.auditEvents.id)),
        };
      }
      return result;
    };
    const send = (cookie, id) => http.standaloneRequest(
      "/api/de-minimis?id=" + encodeURIComponent(id),
      { method: "DELETE", cookie });
    let foreignDenied = 0;
    let revokedDenied = 0;
    for (const attacker of [a, b]) {
      const other = attacker === a ? b : a;
      for (const foreign of [other, victim]) {
        const before = await snapshot();
        const foreignResponse = await send(attacker.cookie, foreign.primary.id);
        const missingResponse = await send(attacker.cookie, victim.peer.id + 100000);
        assertForeignEqualsMissing(foreignResponse, missingResponse,
          [foreign.marker, victim.marker]);
        assert.deepEqual(await snapshot(), before,
          "a foreign/missing grant probe must preserve every grant and audit");
        foreignDenied++;
      }
      // A revoked membership must not authorize an ID-only grant lookup.
      await db.update(s.userOrganizations).set({ active: false }).where(and(
        eq(s.userOrganizations.userId, attacker.owner.id),
        eq(s.userOrganizations.organizationId, attacker.org.id),
      ));
      try {
        const before = await snapshot();
        const response = await send(attacker.cookie, attacker.primary.id);
        assertHiddenGrant(response, [attacker.marker]);
        assert.deepEqual(await snapshot(), before,
          "revoked membership must preserve both grants and audit");
        revokedDenied++;
      } finally {
        await db.update(s.userOrganizations).set({ active: true }).where(and(
          eq(s.userOrganizations.userId, attacker.owner.id),
          eq(s.userOrganizations.organizationId, attacker.org.id),
        ));
      }
      // Real company membership with a non-payroll role is still insufficient.
      const [employeeOnly] = await db.insert(s.users).values({
        name: attacker.marker + " read-only worker",
        email: "grant-worker-" + randomUUID() + "@example.invalid",
        passwordHash: "fictional-session-only", role: "employee",
      }).returning();
      await db.insert(s.userOrganizations).values({
        userId: employeeOnly.id, organizationId: attacker.org.id,
        role: "employee", active: true,
      });
      const employeeSession = await http.standaloneMakeSession(employeeOnly.id);
      const beforeRole = await snapshot();
      const unprivileged = await send(employeeSession.cookie, attacker.primary.id);
      assert.equal(unprivileged.status, 403,
        "employee membership must not allow ending company benefits");
      assert.deepEqual(await snapshot(), beforeRole,
        "role denial must leave all employer grants and audits unchanged");
    }

    let ownSuccess = 0;
    for (const actor of [a, b]) {
      const before = await snapshot();
      const response = await send(actor.cookie, actor.primary.id);
      const after = await snapshot();
      assertOwnedGrantEnded(before[actor.label], after[actor.label], response, {
        id: actor.primary.id, organizationId: actor.org.id, actor: actor.owner.name,
      });
      for (const other of actors.filter(e => e !== actor)) {
        assert.deepEqual(after[other.label], before[other.label],
          "own delete must not change another employer's grants or audit");
      }
      ownSuccess++;
    }
    const final = await snapshot();
    assert.equal(final.VICTIM.grants.filter(g => !g.active).length, 0,
      "real higher-ID victim benefits must remain active");
    assert.equal(final.VICTIM.audit.length, 0,
      "real victim must have no audit events from attackers");
    console.log(JSON.stringify({
      kind: "tenant-de-minimis-delete-pg16-http",
      method: "DELETE /api/de-minimis", employers: 3, independentAttackers: 2,
      ownPersistedEndsAndAudits: ownSuccess,
      realForeignIdDenials: foreignDenied,
      revokedMembershipDenials: revokedDenied,
      nonPayrollRoleDenials: 2,
      higherIdVictimUnchanged: true, missingForeignResponseIdentical: true,
      methodCredits: 0, productionCertified: false, providerCalls: 0,
    }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/tenant-de-minimis-delete-http.mjs")) {
  proveDeMinimisDelete().catch(error => { console.error(error); process.exitCode = 1; });
}
